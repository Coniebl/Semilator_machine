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
               B
             </span>
          )}
        </div>
        <h3 className="font-roboto font-bold text-2xl text-black">
          {status === 'success' ? 'Buyer Connected!' : 'Connecting Buyer...'}
        </h3>
      </div>
    </div>
  );
};

export default function PairingScreen() {
  const router = useRouter();
  const [pairingCode, setPairingCode] = useState("0000000");
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const redirecting = useRef(false);

  useEffect(() => {
    let channel: any;
    let unlinkChannel: any;
    let code: string;
    let pollInterval: NodeJS.Timeout;

    const checkUnlinkStatus = async (currentMachineId: string) => {
      const { data, error } = await supabase
        .from('machines')
        .select('seller_id')
        .eq('machine_id', currentMachineId)
        .maybeSingle();

      if (!data && !error) {
         localStorage.removeItem("linkedSellerId");
         router.replace("/link-device");
      }
    };

    const initPairing = async () => {
      const storedSellerId = localStorage.getItem("linkedSellerId");
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedSellerId || '');
      
      if (!storedSellerId || !isValidUUID) {
        if (!isValidUUID && storedSellerId) {
          localStorage.removeItem("linkedSellerId");
        }
        router.replace("/");
        return;
      }
      setSellerId(storedSellerId);

      const machineId = localStorage.getItem("machine_id");
      if (machineId) {
        checkUnlinkStatus(machineId);
        pollInterval = setInterval(() => checkUnlinkStatus(machineId), 5000);

        unlinkChannel = supabase
          .channel(`machine_unlink_${machineId}_${Date.now()}`)
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'machines', filter: `machine_id=eq.${machineId}` }, () => {
            localStorage.removeItem("linkedSellerId");
            router.replace("/link-device");
          })
          .subscribe();
      }

      // Clean up any stale pending sessions for this seller before creating a new one
      await supabase.from('pairing_sessions').delete().eq('seller_id', storedSellerId).eq('status', 'pending');

      code = generateCode();
      setPairingCode(code);

      const { error } = await supabase.from('pairing_sessions').insert({ 
        code, 
        status: 'pending',
        seller_id: storedSellerId 
      });
      if (error) {
        console.warn("Failed to create pairing session:", error.message);
      }

      // Restore Realtime listener for pairing_sessions
      channel = supabase
        .channel(`pairing_${code}_${Date.now()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pairing_sessions', filter: `code=eq.${code}` }, (payload) => {
          if (redirecting.current) return;
          
          const { buyer_id, paired_user_id, status } = payload.new;
          
          let currentBuyerId = buyer_id;
          if (paired_user_id && !currentBuyerId) {
            currentBuyerId = paired_user_id;
          }
          
          if (status === 'paired') {
             if (currentBuyerId) {
                 redirecting.current = true;
                 setBuyerId(currentBuyerId);
                 setTimeout(() => {
                   router.replace(`/dashboard?sellerId=${storedSellerId}&buyerId=${currentBuyerId}`);
                 }, 2500);
             } else {
                 redirecting.current = true;
                 setBuyerId('guest');
                 setTimeout(() => {
                   router.replace(`/dashboard?sellerId=${storedSellerId}&buyerId=guest`);
                 }, 2500);
             }
          }
        })
        .subscribe();
    };

    initPairing();

    return () => {
      // Clean up the session we created when this component unmounts (e.g. strict mode double-mount, or navigating away)
      if (code) {
        supabase.from('pairing_sessions').delete().eq('code', code).then();
      }
      if (channel) supabase.removeChannel(channel);
      if (unlinkChannel) supabase.removeChannel(unlinkChannel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [router]);

  const codeDisplay = pairingCode.split('').join(' ');

  return (
    <div className="w-full h-full bg-white flex flex-col items-center justify-center p-8 gap-12 select-none relative">
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-roboto font-bold text-[64px] text-black">Buyer Scan QR Code</h1>
        <h2 className="font-roboto font-bold text-3xl text-[#3b7597]">Connect your phone to start the transaction</h2>
      </div>

      <div className="flex flex-row items-center justify-center gap-16">
        <div className="p-6 bg-white flex items-center justify-center shadow-sm rounded-xl">
          <QRCode
            value={pairingCode}
            size={260}
            level="L"
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="bg-[#f0f0f0] border-[3px] border-[#d9d9d9] py-4 px-10 rounded-xl min-w-[380px] flex items-center justify-center shadow-sm">
          <span className="font-roboto font-bold text-5xl text-black tracking-[0.3em]">
            {codeDisplay}
          </span>
        </div>
      </div>

      <ConnectionPopup isActive={!!buyerId} />
    </div>
  );
}
