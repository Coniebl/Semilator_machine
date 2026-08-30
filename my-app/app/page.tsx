"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface FishData {
  id: number;
  top: string;
  delay: string;
  duration: string;
  scale: string;
  waggleSpeed: number;
  zIndex: number;
  opacity: number;
}

const RealisticFish = ({ duration = 0.4 }) => {
  return (
    <svg width="60" height="130" viewBox="-30 -10 60 130" style={{ transform: 'rotate(90deg)', overflow: 'visible' }}>
      {/* Head section */}
      <g>
        <animateTransform 
          attributeName="transform" 
          type="rotate" 
          values="-8 0 20; 8 0 20; -8 0 20" 
          dur={`${duration}s`} 
          repeatCount="indefinite" 
        />
        <ellipse cx="0" cy="20" rx="14" ry="24" fill="black" />
        {/* Pectoral fins */}
        <path d="M -12 25 Q -35 35 -20 50 Z" fill="black" opacity="0.8"/>
        <path d="M 12 25 Q 35 35 20 50 Z" fill="black" opacity="0.8"/>
        
        {/* Body section - delayed to create a traveling wave */}
        <g>
           <animateTransform 
              attributeName="transform" 
              type="rotate" 
              values="-18 0 45; 18 0 45; -18 0 45" 
              dur={`${duration}s`} 
              begin={`-${duration * 0.3}s`}
              repeatCount="indefinite" 
            />
            <ellipse cx="0" cy="45" rx="11" ry="22" fill="black" />
            
            {/* Tail section - delayed further */}
            <g>
               <animateTransform 
                  attributeName="transform" 
                  type="rotate" 
                  values="-35 0 65; 35 0 65; -35 0 65" 
                  dur={`${duration}s`} 
                  begin={`-${duration * 0.6}s`}
                  repeatCount="indefinite" 
                />
                <ellipse cx="0" cy="65" rx="6" ry="18" fill="black" />
                {/* Flowing tail fin */}
                <path d="M 0 75 Q -30 105 -20 120 Q 0 110 0 100 Q 0 110 20 120 Q 30 105 0 75 Z" fill="black" />
            </g>
        </g>
      </g>
    </svg>
  );
};

export default function BootloadScreen() {
  const router = useRouter();
  const [textOpacity, setTextOpacity] = useState(1);
  const [phase, setPhase] = useState(0); 
  const [school, setSchool] = useState<FishData[]>([]);

  useEffect(() => {
    const newSchool: FishData[] = [];
    // Increased count to 35 for a denser school of fish
    for (let i = 0; i < 35; i++) {
      newSchool.push({
        id: i,
        top: `${Math.random() * 80 + 5}%`,
        delay: `${Math.random() * 1.5}s`,
        duration: `${Math.random() * 2 + 3.5}s`, // 3.5s to 5.5s
        scale: `${Math.random() * 0.7 + 0.6}`, // Bigger scale (0.6 to 1.3)
        waggleSpeed: Math.random() * 0.2 + 0.3, // 0.3s to 0.5s for waggle
        zIndex: Math.floor(Math.random() * 10),
        opacity: Math.random() * 0.4 + 0.5, // 0.5 to 0.9 for a much darker, blacker look
      });
    }
    setSchool(newSchool);

    const timer = setTimeout(() => {
      setPhase(1);
    }, 5500); // Wait a bit longer for the slower, bigger fishes to cross
    
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase < 1) return;
    
    let fadeOut = true;
    setTextOpacity(0.4);
    
    const interval = setInterval(() => {
      setTextOpacity(fadeOut ? 1 : 0.4);
      fadeOut = !fadeOut;
    }, 800);
    return () => clearInterval(interval);
  }, [phase]);

  const handlePress = () => {
    const linkedSellerId = localStorage.getItem("linkedSellerId");
    // Validate that the linkedSellerId is a proper UUID (to recover from old test data)
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linkedSellerId || '');

    if (linkedSellerId && isValidUUID) {
      router.replace("/pairing");
    } else {
      if (linkedSellerId) {
        localStorage.removeItem("linkedSellerId");
      }
      router.replace("/link-device");
    }
  };

  return (
    <div 
      className="w-full h-full bg-white flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden relative"
      onClick={handlePress}
    >
      <style>{`
        @keyframes swimAcross {
          0% { transform: translateX(-30vw) translateY(0) rotate(20deg); opacity: 0; }
          10% { opacity: var(--fish-opacity); }
          25% { transform: translateX(15vw) translateY(80px) rotate(0deg); }
          50% { transform: translateX(60vw) translateY(0px) rotate(-20deg); }
          75% { transform: translateX(105vw) translateY(-80px) rotate(0deg); opacity: var(--fish-opacity); }
          90% { opacity: 0; }
          100% { transform: translateX(140vw) translateY(0) rotate(20deg); opacity: 0; }
        }
        
        .school-fish {
          position: absolute;
          left: 0;
          opacity: 0;
          animation: swimAcross var(--fish-duration) ease-in-out var(--fish-delay) forwards;
          will-change: transform, opacity;
        }

        @keyframes fadeIn {
          0% { opacity: 0; transform: scale(0.9) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }

        .fade-in-up {
          opacity: 0;
          animation: fadeIn 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
      `}</style>

      {/* School of fish layer */}
      {phase === 0 && school.map((fish) => (
        <div 
          key={fish.id}
          className="school-fish"
          style={{
            top: fish.top,
            zIndex: fish.zIndex,
            ['--fish-delay' as string]: fish.delay,
            ['--fish-duration' as string]: fish.duration,
            ['--fish-opacity' as string]: fish.opacity,
          }}
        >
          <div style={{ transform: `scale(${fish.scale})`, transformOrigin: 'center center' }}>
            <RealisticFish duration={fish.waggleSpeed} />
          </div>
        </div>
      ))}

      {/* Main content layer */}
      <div className={`flex flex-col items-center justify-center gap-6 z-10 ${phase >= 1 ? 'fade-in-up' : 'opacity-0 hidden'}`}>
        <div className="flex items-center justify-center">
          <Image 
            src="/logo.png" 
            alt="Logo" 
            width={450} 
            height={420} 
            style={{ filter: "brightness(0) saturate(100%) invert(18%) sepia(47%) saturate(3081%) hue-rotate(182deg) brightness(97%) contrast(92%)" }}
            priority
          />
        </div>
        
        <div className="flex flex-col items-center gap-6">
          <h1 className="font-montserrat font-bold text-[#093c5d] text-[88px] text-center tracking-wide">
            SEMILATOR
          </h1>
          <p 
            className="font-roboto font-bold text-[#3b7597] text-4xl text-center transition-opacity duration-700 ease-in-out mb-16"
            style={{ opacity: textOpacity }}
          >
            Tap anywhere to continue
          </p>
        </div>
      </div>
    </div>
  );
}

