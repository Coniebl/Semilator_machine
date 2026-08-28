"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function BootloadScreen() {
  const router = useRouter();
  const [opacity, setOpacity] = useState(0.4);

  useEffect(() => {
    let fadeOut = false;
    const interval = setInterval(() => {
      setOpacity(fadeOut ? 0.4 : 1);
      fadeOut = !fadeOut;
    }, 800);
    return () => clearInterval(interval);
  }, []);

  const handlePress = () => {
    router.replace("/pairing");
  };

  return (
    <div 
      className="w-full h-full bg-white flex flex-col items-center justify-center cursor-pointer select-none"
      onClick={handlePress}
    >
      <div className="flex flex-col items-center justify-center gap-6">
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
        <h1 className="font-montserrat font-bold text-[#093c5d] text-[88px] text-center tracking-wide">
          SEMILATOR
        </h1>
        <p 
          className="font-roboto font-bold text-[#3b7597] text-4xl text-center transition-opacity duration-700 ease-in-out mb-16"
          style={{ opacity }}
        >
          Tap anywhere to continue
        </p>
      </div>
    </div>
  );
}
