/*
 * Semilator Machine - Arduino Uno Controller
 * 
 * Hardware Setup:
 * - MCU: Arduino Uno (powered by Raspberry Pi 5 via USB)
 * - Power Rail 1 (Buck Converter 1):
 *     - 3x VL53L0X ToF Sensors (interfaced via TCA9548A I2C Multiplexer on SDA/SCL)
 *     - 3x 5mm Submerged IR Break-Beam Sensors (Digital Pins D2, D3, D4)
 * - Power Rail 2 (Buck Converter 2 - Isolated GND shared with Uno):
 *     - 3x Servos controlling Trough Trapdoor Gates (PWM Pins D9, D10, D11)
 *
 * Trapdoor Logic:
 * - CLOSED (Angle 0° or 90° depending on linkage): Trapdoor flush with slide floor -> fish continues to Buyer container.
 * - OPEN (Angle 90° or 0°): Trapdoor drops open -> fish falls into Seller return container.
 *
 * Serial Protocol (115200 baud):
 * Commands received from Pi 5:
 *   - START <target>       : Begin count, reset counters, close trapdoors to Buyer
 *   - STOP                 : Stop count, immediately open all trapdoors to Seller
 *   - GATE <trough_1_3> <0|1> : 0 = CLOSE (Buyer), 1 = OPEN (Seller Return)
 *   - PING                 : Replies with PONG
 *   - STATUS               : Replies with current gate & sensor status
 *
 * Events sent to Pi 5:
 *   - IR <trough_id>
 *   - TOF <trough_id> <distance_mm>
 *   - READY
 *   - PONG
 */

#include <Wire.h>
#include <Servo.h>
#include <Adafruit_VL53L0X.h>

// --- Configuration Constants ---
#define TCA_ADDR 0x70       // Default I2C address for TCA9548A multiplexer

// Pin assignments
#define PIN_IR_1 2
#define PIN_IR_2 3
#define PIN_IR_3 4

#define PIN_SERVO_1 9
#define PIN_SERVO_2 10
#define PIN_SERVO_3 11

// Servo Angles: Adjust if your physical linkage requires inverted angles
#define SERVO_CLOSED_ANGLE 0    // Bridge intact: Fish slides into BUYER's container
#define SERVO_OPEN_ANGLE   90   // Trapdoor open: Fish falls into SELLER's return container

// ToF Detection Threshold (distance drop when fish slides under sensor)
#define TOF_BASELINE_DIST_MM 120 // Expected empty trough bottom distance
#define TOF_TRIGGER_DELTA_MM  15 // Drop of 15mm or more indicates a fingerling

// Debounce timings (ms)
#define IR_DEBOUNCE_MS  60
#define TOF_POLL_INTERVAL_MS 25

// --- Global Objects & Variables ---
Adafruit_VL53L0X lox1;
Adafruit_VL53L0X lox2;
Adafruit_VL53L0X lox3;

Servo servo1;
Servo servo2;
Servo servo3;

bool isCounting = false;
int targetCount = 0;

// Gate States (false = CLOSED/Buyer, true = OPEN/Seller Return)
bool gateOpen[3] = { true, true, true }; // Default all OPEN to return before session starts

// IR Sensor States & Debounce
unsigned long lastIrTriggerTime[3] = { 0, 0, 0 };
int lastIrState[3] = { HIGH, HIGH, HIGH };

// ToF Baseline and State tracking
unsigned long lastTofPollTime = 0;
bool tofHasFish[3] = { false, false, false };

// --- Helper: Select TCA9548A Multiplexer Channel ---
void tcaSelect(uint8_t channel) {
  if (channel > 7) return;
  Wire.beginTransmission(TCA_ADDR);
  Wire.write(1 << channel);
  Wire.endTransmission();
}

// --- Helper: Set Gate State ---
void setGate(int troughIndex, bool openState) {
  if (troughIndex < 0 || troughIndex > 2) return;
  gateOpen[troughIndex] = openState;
  
  int angle = openState ? SERVO_OPEN_ANGLE : SERVO_CLOSED_ANGLE;
  if (troughIndex == 0) servo1.write(angle);
  else if (troughIndex == 1) servo2.write(angle);
  else if (troughIndex == 2) servo3.write(angle);
}

void openAllGates() {
  for (int i = 0; i < 3; i++) {
    setGate(i, true); // All OPEN = all drop to seller return
  }
}

void closeAllGates() {
  for (int i = 0; i < 3; i++) {
    setGate(i, false); // All CLOSED = bridge intact to buyer
  }
}

// --- Setup ---
void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(400000); // 400kHz Fast I2C

  // Setup IR Pins with internal pull-up (Break beams pull LOW when blocked)
  pinMode(PIN_IR_1, INPUT_PULLUP);
  pinMode(PIN_IR_2, INPUT_PULLUP);
  pinMode(PIN_IR_3, INPUT_PULLUP);

  // Setup Servos
  servo1.attach(PIN_SERVO_1);
  servo2.attach(PIN_SERVO_2);
  servo3.attach(PIN_SERVO_3);

  // Initialize all gates to OPEN (safety: default return to seller)
  openAllGates();

  // Initialize ToF sensors via TCA9548A
  // Trough 1 on Multiplexer Channel 0
  tcaSelect(0);
  if (!lox1.begin()) {
    Serial.println(F("WARN: ToF 1 not detected on TCA channel 0"));
  }

  // Trough 2 on Multiplexer Channel 1
  tcaSelect(1);
  if (!lox2.begin()) {
    Serial.println(F("WARN: ToF 2 not detected on TCA channel 1"));
  }

  // Trough 3 on Multiplexer Channel 2
  tcaSelect(2);
  if (!lox3.begin()) {
    Serial.println(F("WARN: ToF 3 not detected on TCA channel 2"));
  }

  Serial.println(F("READY"));
}

// --- Process Incoming Serial Commands ---
void processSerialCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd.startsWith("START")) {
    int spaceIdx = cmd.indexOf(' ');
    if (spaceIdx > 0) {
      targetCount = cmd.substring(spaceIdx + 1).toInt();
    } else {
      targetCount = 0;
    }
    isCounting = true;
    closeAllGates(); // Start counting: allow fish to flow to Buyer
    Serial.print(F("STARTED "));
    Serial.println(targetCount);
  }
  else if (cmd.equals("STOP")) {
    isCounting = false;
    openAllGates(); // Stop counting: divert all remaining fish back to Seller
    Serial.println(F("STOPPED"));
  }
  else if (cmd.startsWith("GATE")) {
    // Syntax: GATE <trough: 1, 2, or 3> <state: 0=CLOSE(Buyer), 1=OPEN(Seller)>
    int firstSpace = cmd.indexOf(' ');
    int secondSpace = cmd.indexOf(' ', firstSpace + 1);
    if (firstSpace > 0 && secondSpace > 0) {
      int trough = cmd.substring(firstSpace + 1, secondSpace).toInt() - 1;
      int state = cmd.substring(secondSpace + 1).toInt();
      if (trough >= 0 && trough <= 2) {
        setGate(trough, state == 1);
        Serial.print(F("ACK GATE "));
        Serial.print(trough + 1);
        Serial.print(F(" "));
        Serial.println(state);
      }
    }
  }
  else if (cmd.equals("PING")) {
    Serial.println(F("PONG"));
  }
  else if (cmd.equals("STATUS")) {
    Serial.print(F("STATUS isCounting:"));
    Serial.print(isCounting ? "1" : "0");
    Serial.print(F(" G1:"));
    Serial.print(gateOpen[0] ? "1" : "0");
    Serial.print(F(" G2:"));
    Serial.print(gateOpen[1] ? "1" : "0");
    Serial.print(F(" G3:"));
    Serial.println(gateOpen[2] ? "1" : "0");
  }
}

// --- Poll IR Sensors ---
void pollIrSensors() {
  unsigned long now = millis();
  int pins[3] = { PIN_IR_1, PIN_IR_2, PIN_IR_3 };

  for (int i = 0; i < 3; i++) {
    int currentVal = digitalRead(pins[i]);
    // Break-beam active trigger: goes LOW when fish breaks the beam
    if (currentVal == LOW && lastIrState[i] == HIGH) {
      if (now - lastIrTriggerTime[i] > IR_DEBOUNCE_MS) {
        lastIrTriggerTime[i] = now;
        Serial.print(F("IR "));
        Serial.println(i + 1);
      }
    }
    lastIrState[i] = currentVal;
  }
}

// --- Poll ToF Sensors via TCA9548A ---
void pollTofSensors() {
  unsigned long now = millis();
  if (now - lastTofPollTime < TOF_POLL_INTERVAL_MS) return;
  lastTofPollTime = now;

  for (uint8_t i = 0; i < 3; i++) {
    tcaSelect(i);
    VL53L0X_RangingMeasurementData_t measure;
    
    bool valid = false;
    uint16_t dist = 0;

    if (i == 0) {
      lox1.rangingTest(&measure, false);
      if (measure.RangeStatus != 4) { dist = measure.RangeMilliMeter; valid = true; }
    } else if (i == 1) {
      lox2.rangingTest(&measure, false);
      if (measure.RangeStatus != 4) { dist = measure.RangeMilliMeter; valid = true; }
    } else if (i == 2) {
      lox3.rangingTest(&measure, false);
      if (measure.RangeStatus != 4) { dist = measure.RangeMilliMeter; valid = true; }
    }

    if (valid && dist > 10 && dist < 300) {
      // Check if distance indicates a fish passing
      if (dist < (TOF_BASELINE_DIST_MM - TOF_TRIGGER_DELTA_MM)) {
        if (!tofHasFish[i]) {
          tofHasFish[i] = true;
          Serial.print(F("TOF "));
          Serial.print(i + 1);
          Serial.print(F(" "));
          Serial.println(dist);
        }
      } else {
        tofHasFish[i] = false;
      }
    }
  }
}

// --- Main Loop ---
void loop() {
  // Read Serial commands from Pi 5
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    processSerialCommand(cmd);
  }

  // Active sensor reading
  pollIrSensors();
  pollTofSensors();
}
