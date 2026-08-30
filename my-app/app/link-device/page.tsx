"use client";
import QRCode from "react-qr-code";
import { useEffect, useState, useRef } from "react";
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

const ConnectionPopup = ({ isActive }: { isActive: boolean }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  useEffect(() => {
    if (isActive && status === 'idle') {
      setStatus('loading');
      setTimeout(() => {
        setStatus('success');
      }, 1200);
    }
  }, [isActive, status]);

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm transition-opacity duration-300">
      <div className="bg-white p-10 rounded-2xl shadow-2xl flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-300">
        <div className={`w-32 h-32 rounded-full border-[8px] flex items-center justify-center transition-all duration-300 ease-in-out ${
          status === 'success' 
            ? 'border-[#10B981] bg-[#10B981] scale-110' 
            : status === 'loading'
            ? 'border-[#D9D9D9] border-t-[#10B981] border-r-[#10B981] animate-spin'
            : 'border-[#D9D9D9] bg-white'
        }`}>
          {status === 'success' ? (
             <span className="font-roboto font-bold text-7xl text-white">✔</span>
          ) : (
             <span className={`font-roboto font-bold text-5xl text-black ${status === 'loading' ? 'animate-[spin_1s_linear_infinite_reverse]' : ''}`}>
               S
             </span>
          )}
        </div>
        <h3 className="font-roboto font-bold text-2xl text-black">
          {status === 'success' ? 'Link Successful!' : 'Linking Device...'}
        </h3>
      </div>
    </div>
  );
};

export default function LinkDeviceScreen() {
  const router = useRouter();
  const [machineCode, setMachineCode] = useState("0000000");
  const [isLinking, setIsLinking] = useState(false);
  const isLinkingRef = useRef(false);

  useEffect(() => {
    let channel: any;
    let code: string;

    // Always start with a fresh slate when linking a new device
    localStorage.removeItem('sim_transactions_history');
    localStorage.removeItem('last_sim_buyer');

    const initLink = async () => {
      // For real testing: The machine should ideally have a static machine_id
      // to ensure only 1 device links to it. 
      // Example: Upsert to a 'machine_links' table with a fixed machine_id.
      // For now, using pairing_sessions for simulation.
      code = generateCode();
      setMachineCode(code);

      const { error } = await supabase.from('pairing_sessions').insert({ code, status: 'pending' });
      if (error) {
        console.warn("Failed to create link session:", error.message);
        alert("Database Error (pairing_sessions): " + error.message);
      }

      channel = supabase
        .channel(`link_${code}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pairing_sessions', filter: `code=eq.${code}` }, (payload) => {
          const { seller_id } = payload.new;
          if (seller_id && !isLinkingRef.current) {
            isLinkingRef.current = true;
            setIsLinking(true);
            localStorage.setItem("linkedSellerId", seller_id);
            setTimeout(() => {
              router.replace(`/pairing`);
            }, 2500); // Wait for loading and success animation
          }
        })
        .subscribe();
    };

    initLink();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  const handleSimulation = () => {
    if (!isLinkingRef.current) {
      isLinkingRef.current = true;
      setIsLinking(true);
      
      // Real Seller's UUID from Supabase Authentication
      const simSellerId = 'd6732e21-e322-438d-8c4b-3a5afe249e22';
      localStorage.setItem("linkedSellerId", simSellerId);
      
      // Guarantee the user exists in the profiles table to satisfy foreign keys
      supabase.from('profiles').upsert({ id: simSellerId, username: 'Test Seller' }).then(({ error }) => {
        if (error) console.error("Profiles Upsert Error:", error.message);
      });
      
      // Update pairing_sessions to reflect the simulation in the database
      supabase.from('pairing_sessions').update({ seller_id: simSellerId }).eq('code', machineCode).then(({ error }) => {
        if (error) console.error("Pairing Sessions Update Error:", error.message);
      });
      
      setTimeout(() => {
        router.replace('/pairing');
      }, 2500); // 1.2s loading + 1.3s showing checkmark
    }
  };

  const codeDisplay = machineCode.split('').join(' ');

  return (
    <div className="w-full h-full bg-white flex flex-col items-center justify-center p-8 gap-12 relative select-none">
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-roboto font-bold text-[56px] text-black tracking-wide">LINK TO MOBILE DEVICE</h1>
        <h2 className="font-roboto font-bold text-3xl text-[#3b7597]">Bind an account from mobile phone</h2>
      </div>

      <div className="p-6 bg-white flex items-center justify-center shadow-sm rounded-xl">
        <QRCode
          value={`LINK MACHINE TO DEVICE`}
          size={300}
          level="L"
        />
      </div>

      <div className="flex flex-col items-center gap-4 mt-4">
        <div className="bg-[#f0f0f0] border-[3px] border-[#d9d9d9] py-4 px-10 rounded-xl min-w-[380px] flex items-center justify-center shadow-sm">
          <span className="font-roboto font-bold text-5xl text-black tracking-[0.3em]">
            {codeDisplay}
          </span>
        </div>
        
        <button 
          onClick={handleSimulation}
          className="px-6 py-2 bg-gray-200 text-gray-700 font-bold rounded-full hover:bg-gray-300 transition-colors mt-4"
        >
          Simulate (Test Mode)
        </button>
      </div>

      <ConnectionPopup isActive={isLinking} />
    </div>
  );
}
