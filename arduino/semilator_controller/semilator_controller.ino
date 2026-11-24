/*
 * Semilator Machine - Arduino Uno Controller (2-Trough System)
 *
 * Hardware Setup:
 * - MCU: Arduino Uno (powered by Raspberry Pi 5 via USB)
 * - Power Rail 1 (Buck Converter 1):
 *     - 2x VL53L0X ToF Sensors (interfaced via TCA9548A I2C Multiplexer on SDA/SCL, channels 0 & 1)
 *     - 2x 5mm Submerged IR Break-Beam Sensors (Hardware Interrupt Pins D2, D3)
 * - Power Rail 2 (Buck Converter 2 - Isolated GND shared with Uno):
 *     - 2x Servos controlling Trough Trapdoor Gates (PWM Pins D9, D10)
 *
 * Trapdoor Logic:
 * - CLOSED (Angle 0°): Trapdoor flush with slide floor -> fish continues to Buyer container.
 * - OPEN (Angle 90°): Trapdoor drops open -> fish falls into Seller return container.
 *
 * Serial Protocol (115200 baud):
 * Commands received from Pi 5:
 *   - START <target>          : Begin count, close trapdoors to Buyer
 *   - STOP                    : Stop count, immediately open all trapdoors to Seller
 *   - GATE <trough_1_2> <0|1> : 0 = CLOSE (Buyer), 1 = OPEN (Seller Return)
 *   - CALIBRATE               : Re-measure empty-trough ToF baselines
 *   - PING                    : Replies with PONG
 *   - STATUS                  : Replies with current gate & baseline status
 *
 * Events sent to Pi 5:
 *   - IR <trough_id>
 *   - TOF <trough_id> <distance_mm>
 *   - CALIBRATED B1:<mm> B2:<mm>
 *   - READY
 *   - PONG
 */

#include <Wire.h>
#include <Servo.h>
#include <Adafruit_VL53L0X.h>
#include <string.h>
#include <stdlib.h>

// --- Configuration Constants ---
#define NUM_TROUGHS 2
#define TCA_ADDR    0x70  // Default I2C address for TCA9548A multiplexer

// Pin assignments (2 troughs)
#define PIN_IR_1    2     // Hardware INT0
#define PIN_IR_2    3     // Hardware INT1

#define PIN_SERVO_1 9
#define PIN_SERVO_2 10

// Servo Angles: Adjust if your physical linkage requires inverted angles
#define SERVO_CLOSED_ANGLE 0   // Bridge intact: Fish slides into BUYER's container
#define SERVO_OPEN_ANGLE   90  // Trapdoor open: Fish falls into SELLER's return container

// ToF Detection & Auto-Calibration Settings
#define TOF_DEFAULT_BASELINE_MM  120  // Fallback empty trough distance if calibration fails
#define TOF_TRIGGER_DELTA_MM      15  // Drop of 15mm or more indicates a fingerling
#define TOF_HYSTERESIS_MM          5  // Distance must rise 5mm above trigger to reset
#define TOF_CALIBRATION_SAMPLES   10  // Samples averaged per sensor on startup / CALIBRATE

// Timings (ms)
#define IR_DEBOUNCE_MS       60
#define TOF_POLL_INTERVAL_MS 10

// Non-blocking Serial line buffer
#define SERIAL_BUF_SIZE 64

// --- Global Objects & Variables ---
Adafruit_VL53L0X lox[NUM_TROUGHS];
Servo servos[NUM_TROUGHS];

bool isCounting = false;
int targetCount = 0;

// Gate States (false = CLOSED/Buyer, true = OPEN/Seller Return)
bool gateOpen[NUM_TROUGHS] = { true, true };  // Default all OPEN to return before session starts

// Interrupt-driven IR state (shared between ISR and loop)
volatile unsigned long lastIrTriggerTime[NUM_TROUGHS] = { 0, 0 };
volatile uint8_t irPendingCount[NUM_TROUGHS] = { 0, 0 };

// ToF detection, baseline, and alternating poll state
bool tofDetected[NUM_TROUGHS] = { false, false };
uint16_t tofBaselineMm[NUM_TROUGHS] = { TOF_DEFAULT_BASELINE_MM, TOF_DEFAULT_BASELINE_MM };
bool tofHasFish[NUM_TROUGHS] = { false, false };
unsigned long lastTofPollTime = 0;
uint8_t tofNextChannel = 0;

// Serial input buffer
char serialBuf[SERIAL_BUF_SIZE];
uint8_t serialBufLen = 0;

// --- IR Hardware Interrupt Handlers ---
void handleIrInterrupt(uint8_t idx) {
  unsigned long now = millis();
  if (now - lastIrTriggerTime[idx] > IR_DEBOUNCE_MS) {
    lastIrTriggerTime[idx] = now;
    if (irPendingCount[idx] < 255) {
      irPendingCount[idx]++;
    }
  }
}

void onIr1Fall() {
  handleIrInterrupt(0);
}

void onIr2Fall() {
  handleIrInterrupt(1);
}

// --- Helper: Select TCA9548A Multiplexer Channel ---
void tcaSelect(uint8_t channel) {
  if (channel > 7) return;
  Wire.beginTransmission(TCA_ADDR);
  Wire.write(1 << channel);
  Wire.endTransmission();
}

// --- Helper: Set Gate State ---
void setGate(int troughIndex, bool openState) {
  if (troughIndex < 0 || troughIndex >= NUM_TROUGHS) return;
  gateOpen[troughIndex] = openState;
  int angle = openState ? SERVO_OPEN_ANGLE : SERVO_CLOSED_ANGLE;
  servos[troughIndex].write(angle);
}

void openAllGates() {
  for (int i = 0; i < NUM_TROUGHS; i++) {
    setGate(i, true);  // All OPEN = all drop to seller return
  }
}

void closeAllGates() {
  for (int i = 0; i < NUM_TROUGHS; i++) {
    setGate(i, false);  // All CLOSED = bridge intact to buyer
  }
}

// --- Helper: Auto-Calibrate Empty-Trough ToF Baselines ---
void calibrateTofBaselines() {
  for (uint8_t i = 0; i < NUM_TROUGHS; i++) {
    tofHasFish[i] = false;
    if (!tofDetected[i]) {
      tofBaselineMm[i] = TOF_DEFAULT_BASELINE_MM;
      continue;
    }

    tcaSelect(i);
    uint32_t sum = 0;
    uint8_t validSamples = 0;

    for (uint8_t s = 0; s < TOF_CALIBRATION_SAMPLES; s++) {
      VL53L0X_RangingMeasurementData_t measure;
      lox[i].rangingTest(&measure, false);
      if (measure.RangeStatus != 4 && measure.RangeMilliMeter > 20 && measure.RangeMilliMeter < 400) {
        sum += measure.RangeMilliMeter;
        validSamples++;
      }
      delay(10);
    }

    if (validSamples > 0) {
      tofBaselineMm[i] = (uint16_t)(sum / validSamples);
    } else {
      tofBaselineMm[i] = TOF_DEFAULT_BASELINE_MM;
    }
  }

  Serial.print(F("CALIBRATED B1:"));
  Serial.print(tofBaselineMm[0]);
  Serial.print(F(" B2:"));
  Serial.println(tofBaselineMm[1]);
}

// --- Setup ---
void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(400000);  // 400kHz Fast I2C

  // Setup IR Pins with internal pull-up & hardware falling-edge interrupts
  pinMode(PIN_IR_1, INPUT_PULLUP);
  pinMode(PIN_IR_2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_IR_1), onIr1Fall, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_IR_2), onIr2Fall, FALLING);

  // Setup Servos
  servos[0].attach(PIN_SERVO_1);
  servos[1].attach(PIN_SERVO_2);

  // Initialize all gates to OPEN (safety: default return to seller)
  openAllGates();

  // Initialize ToF sensors via TCA9548A (Channels 0 & 1)
  for (uint8_t i = 0; i < NUM_TROUGHS; i++) {
    tcaSelect(i);
    if (lox[i].begin()) {
      tofDetected[i] = true;
    } else {
      tofDetected[i] = false;
      Serial.print(F("WARN: ToF "));
      Serial.print(i + 1);
      Serial.print(F(" not detected on TCA channel "));
      Serial.println(i);
    }
  }

  // Auto-calibrate empty-trough baseline distances
  calibrateTofBaselines();

  Serial.println(F("READY"));
}

// --- Process Incoming Serial Commands (Non-Blocking Fixed Buffer) ---
void processSerialCommand(char *cmd) {
  // Trim leading whitespace
  while (*cmd == ' ' || *cmd == '\t') cmd++;

  // Trim trailing whitespace
  size_t len = strlen(cmd);
  while (len > 0 && (cmd[len - 1] == ' ' || cmd[len - 1] == '\t' || cmd[len - 1] == '\r')) {
    cmd[--len] = '\0';
  }
  if (len == 0) return;

  if (strncmp(cmd, "START", 5) == 0) {
    targetCount = (len > 6 && cmd[5] == ' ') ? atoi(cmd + 6) : 0;
    isCounting = true;
    closeAllGates();  // Start counting: allow fish to flow to Buyer
    Serial.print(F("STARTED "));
    Serial.println(targetCount);
  }
  else if (strcmp(cmd, "STOP") == 0) {
    isCounting = false;
    openAllGates();  // Stop counting: divert all remaining fish back to Seller
    Serial.println(F("STOPPED"));
  }
  else if (strncmp(cmd, "GATE ", 5) == 0) {
    // Syntax: GATE <trough: 1 or 2> <state: 0=CLOSE(Buyer), 1=OPEN(Seller)>
    char *p1 = cmd + 5;
    char *p2 = strchr(p1, ' ');
    if (p2 != NULL) {
      int trough = atoi(p1) - 1;
      int state = atoi(p2 + 1);
      if (trough >= 0 && trough < NUM_TROUGHS) {
        setGate(trough, state == 1);
        Serial.print(F("ACK GATE "));
        Serial.print(trough + 1);
        Serial.print(F(" "));
        Serial.println(state);
      }
    }
  }
  else if (strcmp(cmd, "CALIBRATE") == 0) {
    calibrateTofBaselines();
  }
  else if (strcmp(cmd, "PING") == 0) {
    Serial.println(F("PONG"));
  }
  else if (strcmp(cmd, "STATUS") == 0) {
    Serial.print(F("STATUS isCounting:"));
    Serial.print(isCounting ? "1" : "0");
    Serial.print(F(" G1:"));
    Serial.print(gateOpen[0] ? "1" : "0");
    Serial.print(F(" G2:"));
    Serial.print(gateOpen[1] ? "1" : "0");
    Serial.print(F(" B1:"));
    Serial.print(tofBaselineMm[0]);
    Serial.print(F(" B2:"));
    Serial.println(tofBaselineMm[1]);
  }
}

void pollSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      serialBuf[serialBufLen] = '\0';
      processSerialCommand(serialBuf);
      serialBufLen = 0;
    } else if (serialBufLen < SERIAL_BUF_SIZE - 1) {
      serialBuf[serialBufLen++] = c;
    }
  }
}

// --- Drain Interrupt-Captured IR Events ---
void drainIrEvents() {
  uint8_t counts[NUM_TROUGHS];

  noInterrupts();
  for (uint8_t i = 0; i < NUM_TROUGHS; i++) {
    counts[i] = irPendingCount[i];
    irPendingCount[i] = 0;
  }
  interrupts();

  for (uint8_t i = 0; i < NUM_TROUGHS; i++) {
    while (counts[i] > 0) {
      Serial.print(F("IR "));
      Serial.println(i + 1);
      counts[i]--;
    }
  }
}

// --- Poll ToF Sensors via TCA9548A (Alternating Trough 1 & Trough 2) ---
void pollNextTofSensor() {
  unsigned long now = millis();
  if (now - lastTofPollTime < TOF_POLL_INTERVAL_MS) return;
  lastTofPollTime = now;

  uint8_t i = tofNextChannel;
  tofNextChannel = (tofNextChannel + 1) % NUM_TROUGHS;

  if (!tofDetected[i]) return;

  tcaSelect(i);
  VL53L0X_RangingMeasurementData_t measure;
  lox[i].rangingTest(&measure, false);

  if (measure.RangeStatus != 4) {
    uint16_t dist = measure.RangeMilliMeter;
    if (dist > 10 && dist < 400) {
      uint16_t triggerDist = (tofBaselineMm[i] > TOF_TRIGGER_DELTA_MM)
                                 ? (tofBaselineMm[i] - TOF_TRIGGER_DELTA_MM)
                                 : 10;
      uint16_t clearDist = triggerDist + TOF_HYSTERESIS_MM;

      if (dist < triggerDist) {
        if (!tofHasFish[i]) {
          tofHasFish[i] = true;
          Serial.print(F("TOF "));
          Serial.print(i + 1);
          Serial.print(F(" "));
          Serial.println(dist);
        }
      } else if (dist >= clearDist) {
        tofHasFish[i] = false;
      }
    }
  }
}

// --- Main Loop ---
void loop() {
  pollSerial();
  drainIrEvents();
  pollNextTofSensor();
}
