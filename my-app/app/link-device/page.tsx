"use client";
import QRCode from "react-qr-code";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const generateCode = () => {
  const chars = "0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
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
  const [machineCode, setMachineCode] = useState("000000");
  const [isLinking, setIsLinking] = useState(false);
  const isLinkingRef = useRef(false);

  useEffect(() => {
    let channel: any;
    let code: string;
    let pollInterval: NodeJS.Timeout;

    // Always start with a fresh slate when linking a new device
    localStorage.removeItem('sim_transactions_history');
    localStorage.removeItem('last_sim_buyer');

    const checkLinkStatus = async (currentCode: string) => {
      if (isLinkingRef.current) return;
      const { data, error } = await supabase
        .from('machines')
        .select('seller_id')
        .eq('machine_id', currentCode)
        .maybeSingle();

      if (data?.seller_id && !isLinkingRef.current) {
        isLinkingRef.current = true;
        setIsLinking(true);
        localStorage.setItem("linkedSellerId", data.seller_id);
        setTimeout(() => {
          router.replace(`/pairing`);
        }, 2500);
      }
    };

    const initLink = async () => {
      let savedMachineId = localStorage.getItem("machine_id");
      if (!savedMachineId) {
        savedMachineId = generateCode();
        localStorage.setItem("machine_id", savedMachineId);
      }
      code = savedMachineId;
      setMachineCode(code);

      // Check immediately and then poll every 2 seconds as a fallback for Realtime
      checkLinkStatus(code);
      pollInterval = setInterval(() => checkLinkStatus(code), 2000);

      channel = supabase
        .channel(`link_${code}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'machines', filter: `machine_id=eq.${code}` }, (payload) => {
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
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [router]);

  const codeDisplay = machineCode.split('').join(' ');

  return (
    <div className="w-full h-full bg-white flex flex-col items-center justify-center p-8 gap-12 relative select-none">
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-roboto font-bold text-[56px] text-black tracking-wide">LINK TO MOBILE DEVICE</h1>
        <h2 className="font-roboto font-bold text-3xl text-[#3b7597]">Bind an account from mobile phone</h2>
      </div>

      <div className="p-6 bg-white flex items-center justify-center shadow-sm rounded-xl">
        <QRCode
          value={machineCode}
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
      </div>

      <ConnectionPopup isActive={isLinking} />
    </div>
  );
}
