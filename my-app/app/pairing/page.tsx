"use client";
import QRCode from "react-qr-code";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const generateCode = () => {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const ConnectionCircle = ({ label, isActive }: { label: string; isActive: boolean }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  useEffect(() => {
    if (isActive && status === 'idle') {
      setStatus('loading');
      setTimeout(() => {
        setStatus('success');
      }, 1000);
    }
  }, [isActive, status]);

  return (
    <div className={`w-28 h-28 rounded-full border-[6px] flex items-center justify-center transition-all duration-300 ease-in-out ${
      status === 'success' 
        ? 'border-[#10B981] bg-[#10B981] scale-110' 
        : status === 'loading'
        ? 'border-[#D9D9D9] border-t-[#10B981] border-r-[#10B981] animate-spin'
        : 'border-[#D9D9D9] bg-white'
    }`}>
      {status === 'success' ? (
         <span className="font-roboto font-bold text-5xl text-white">✔</span>
      ) : (
         <span className={`font-roboto font-bold text-5xl text-black ${status === 'loading' ? 'animate-[spin_1s_linear_infinite_reverse]' : ''}`}>
           {label}
         </span>
      )}
    </div>
  );
};

export default function PairingScreen() {
  const router = useRouter();
  const [pairingCode, setPairingCode] = useState("0000000");
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [buyerId, setBuyerId] = useState<string | null>(null);

  useEffect(() => {
    let channel: any;
    let code: string;

    const initPairing = async () => {
      code = generateCode();
      setPairingCode(code);

      const { error } = await supabase.from('pairing_sessions').insert({ code, status: 'pending' });
      if (error) {
        console.error("Failed to create pairing session:", error);
      }

      channel = supabase
        .channel(`pairing_${code}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pairing_sessions', filter: `code=eq.${code}` }, (payload) => {
          const { seller_id, buyer_id, paired_user_id } = payload.new;
          
          let currentSellerId = seller_id;
          let currentBuyerId = buyer_id;

          if (paired_user_id && !currentBuyerId) {
            currentBuyerId = paired_user_id;
          }
          
          if (currentSellerId) setSellerId(currentSellerId);
          if (currentBuyerId) setBuyerId(currentBuyerId);
          
          if (currentSellerId && currentBuyerId) {
             setTimeout(() => {
               router.replace(`/dashboard?sellerId=${currentSellerId}&buyerId=${currentBuyerId}`);
             }, 2000);
          }
        })
        .subscribe();
    };

    initPairing();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  const handleProceedWithoutBuyer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sellerId) {
      router.replace(`/dashboard?sellerId=${sellerId}`);
    }
  };

  const handleScreenTap = () => {
    if (!sellerId && !buyerId) {
      setSellerId('sim-seller');
      setBuyerId('sim-buyer');
      setTimeout(() => {
        router.replace('/dashboard');
      }, 2000);
    }
  };

  const codeDisplay = pairingCode.split('').join(' ');

  return (
    <div 
      className="w-full h-full bg-white flex flex-col items-center justify-center p-8 gap-12 cursor-pointer select-none"
      onClick={handleScreenTap}
    >
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-roboto font-bold text-[64px] text-black">Scan QR Code</h1>
        <h2 className="font-roboto font-bold text-3xl text-[#3b7597]">Use your phone to link the Semilator</h2>
      </div>

      <div className="flex flex-row items-center justify-center gap-16">
        <ConnectionCircle label="S" isActive={!!sellerId} />
        
        <div className="p-6 bg-white flex items-center justify-center shadow-sm rounded-xl">
          <QRCode
            value={pairingCode}
            size={260}
            level="L"
          />
        </div>

        <ConnectionCircle label="B" isActive={!!buyerId} />
      </div>

      <div className="bg-white border-4 border-[#D9D9D9] py-4 px-10 rounded-xl min-w-[380px] flex items-center justify-center">
        <span className="font-roboto font-bold text-5xl text-black tracking-[0.25em]">
          {codeDisplay}
        </span>
      </div>

      {sellerId && !buyerId && (
        <button 
          className="bg-[#3b7597] py-3 px-6 rounded-lg absolute bottom-6 right-6 font-roboto font-bold text-white text-lg hover:bg-[#2c5871] transition-colors"
          onClick={handleProceedWithoutBuyer}
        >
          Proceed without Buyer
        </button>
      )}
    </div>
  );
}
