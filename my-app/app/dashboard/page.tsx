"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, Suspense } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';

const CustomFish = ({ animDelay, opacity }: { animDelay: string, opacity: number }) => (
  <div 
    className={`-mx-1 transition-opacity duration-300 ${opacity === 1 ? 'animate-bounce' : ''}`}
    style={{ opacity, animationDelay: animDelay }}
  >
    <svg width="40" height="28" viewBox="0 0 100 100">
      <path d="M 20 50 L 5 25 L 15 50 L 5 75 Z" fill="#1A365D" />
      <path d="M 35 30 L 45 5 L 55 25 Z" fill="#1A365D" />
      <path d="M 40 70 L 45 90 L 55 75 L 60 85 L 65 70 Z" fill="#1A365D" />
      <path d="M 15 50 C 15 80, 85 80, 95 50 C 85 20, 15 20, 15 50 Z" fill="#1A365D" />
      <circle cx="80" cy="45" r="5" fill="#FFFFFF" />
      <circle cx="82" cy="45" r="2" fill="#1A365D" />
      <path d="M 70 35 C 75 45, 75 55, 70 65" stroke="#FFFFFF" strokeWidth="3" fill="none" />
      <path d="M 45 50 C 55 55, 60 65, 50 65 C 55 60, 50 55, 45 50 Z" fill="#FFFFFF" />
      <path d="M 25 65 L 35 75 L 30 65 Z" fill="#FFFFFF" />
    </svg>
  </div>
);

const FishAnimation = ({ isRunning }: { isRunning: boolean }) => {
  const op = isRunning ? 1 : 0.4;
  return (
    <div className="flex flex-row mx-2 py-1 items-center h-8">
      <CustomFish animDelay="0ms" opacity={op} />
      <CustomFish animDelay="150ms" opacity={op} />
      <CustomFish animDelay="300ms" opacity={op} />
    </div>
  );
};

const ProfileAvatar = ({ imageUrl, className = "" }: { imageUrl?: string, className?: string }) => {
  return (
    <div className={`w-10 h-10 rounded-full bg-[#9a9794] border border-white flex justify-center items-center overflow-hidden flex-shrink-0 ${className}`}>
      {imageUrl ? (
        <img src={imageUrl} alt="Profile" className="w-full h-full object-cover" />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </div>
  );
};

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sellerId = searchParams.get('sellerId');
  const buyerId = searchParams.get('buyerId');
  const sellerPicUrl = searchParams.get('sellerPicUrl');
  const buyerPicUrl = searchParams.get('buyerPicUrl');
  
  const [sellerName, setSellerName] = useState('Seller1');
  const [buyerName, setBuyerName] = useState('Buyer1');

  useEffect(() => {
    const fetchProfiles = async () => {
      if (sellerId) {
        const { data } = await supabase.from('profiles').select('username').eq('id', sellerId).single();
        if (data) setSellerName(data.username || 'Seller1');
      }
      if (buyerId) {
         const { data } = await supabase.from('profiles').select('username').eq('id', buyerId).single();
         if (data) setBuyerName(data.username || 'Buyer1');
      }
    };
    fetchProfiles();
  }, [sellerId, buyerId]);

  const [timeStr, setTimeStr] = useState('');
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const yyyy = now.getFullYear();
      const HH = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      setTimeStr(`${mm}/${dd}/${yyyy} ${HH}:${min}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const [targetStr, setTargetStr] = useState('');
  const target = parseInt(targetStr) || 0;
  const [priceStr, setPriceStr] = useState('');
  const pricePerPiece = parseFloat(priceStr) || 0;
  const [counted, setCounted] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const total = counted * pricePerPiece;

  const [verification, setVerification] = useState({ vision: 0, sensor3: 0, thermal: 0, final: 0, show: false });
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .gte('created_at', startOfToday.toISOString())
        .order('created_at', { ascending: false });
      
      if (data) {
        const userIds = [...new Set(data.map(t => t.buyer_id).filter(Boolean))];
        let profilesMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds);
          if (profiles) {
            profiles.forEach(p => { profilesMap[p.id] = p.username || 'Buyer'; });
          }
        }

        const mapped = data.map(item => {
          const d = new Date(item.created_at);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const yyyy = d.getFullYear();
          const HH = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          
          let itemBuyerName = 'Buyer';
          if (item.buyer_id) {
            itemBuyerName = profilesMap[item.buyer_id] || 'Buyer';
          }

          return {
            id: item.id,
            count: item.quantity,
            amount: item.total_price,
            date: `${mm}/${dd}/${yyyy} ${HH}:${min}`,
            buyerName: itemBuyerName
          };
        });

        // Merge with any local simulation transactions
        const localHistoryStr = localStorage.getItem('sim_transactions_history');
        if (localHistoryStr) {
          try {
            const localHistory = JSON.parse(localHistoryStr);
            // Only keep local history from today
            const todayLocal = localHistory.filter((item: any) => {
              const itemDate = new Date(item.rawDate);
              return itemDate >= startOfToday;
            });
            
            // Combine and sort by date descending
            const combined = [...mapped, ...todayLocal].sort((a, b) => {
              return new Date(b.rawDate || b.date).getTime() - new Date(a.rawDate || a.date).getTime();
            });
            setHistory(combined);
            // Clean up old local history
            localStorage.setItem('sim_transactions_history', JSON.stringify(todayLocal));
          } catch (e) {
            setHistory(mapped);
          }
        } else {
          setHistory(mapped);
        }
      } else {
        // Fallback to local history if Supabase fails entirely
        const localHistoryStr = localStorage.getItem('sim_transactions_history');
        if (localHistoryStr) {
          try {
            const localHistory = JSON.parse(localHistoryStr);
            const todayLocal = localHistory.filter((item: any) => {
              const itemDate = new Date(item.rawDate);
              return itemDate >= startOfToday;
            });
            setHistory(todayLocal.sort((a: any, b: any) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime()));
          } catch (e) {
            setHistory([]);
          }
        }
      }
    };
    fetchHistory();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let finished = false;
    if (isRunning) {
      interval = setInterval(() => {
        setCounted(prev => {
          if (prev >= target - 1) {
            if (!finished) {
              finished = true;
              setIsRunning(false);
            const finalCount = target;
            
            const rand = Math.random();
            let v = target;
            let s3 = target;
            let t = target;

            if (rand < 0.34) {
               // All match
            } else if (rand < 0.67) {
               // Two match
               const diffAmount = Math.floor(Math.random() * 5) + 1;
               const pick = Math.floor(Math.random() * 3);
               if (pick === 0) v = Math.max(0, target - diffAmount);
               else if (pick === 1) s3 = Math.max(0, target - diffAmount);
               else t = Math.max(0, target - diffAmount);
            } else {
               // None match
               const diff1 = Math.floor(Math.random() * 3) + 1;
               const diff2 = diff1 + Math.floor(Math.random() * 3) + 1;
               const pickTarget = Math.floor(Math.random() * 3);
               if (pickTarget === 0) {
                 s3 = Math.max(0, target - diff1);
                 t = Math.max(0, target - diff2);
               } else if (pickTarget === 1) {
                 v = Math.max(0, target - diff1);
                 t = Math.max(0, target - diff2);
               } else {
                 v = Math.max(0, target - diff1);
                 s3 = Math.max(0, target - diff2);
               }
            }

            const counts = [v, s3, t];
            const freq: any = {};
            let maxFreq = 0;
            let majorityVal: number | null = null;
            counts.forEach(val => {
               freq[val] = (freq[val] || 0) + 1;
               if (freq[val] > maxFreq) {
                 maxFreq = freq[val];
                 majorityVal = val;
               }
            });

            let finalVerified = 0;
            if (maxFreq >= 2 && majorityVal !== null) {
               finalVerified = majorityVal;
            } else {
               finalVerified = Math.round((v + s3 + t) / 3);
            }

            setVerification({ vision: v, sensor3: s3, thermal: t, final: finalVerified, show: true });

            const finalTotal = finalVerified * pricePerPiece;

            let validBuyerId = (buyerId && String(buyerId).length === 36) ? buyerId : 'f1296eb7-7af1-47de-9d2e-3c836f645b80';
            let validSellerId = (sellerId && String(sellerId).length === 36) ? sellerId : 'd6732e21-e322-438d-8c4b-3a5afe249e22';

            const now = new Date();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const yyyy = now.getFullYear();
            const HH = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const dateStr = `${mm}/${dd}/${yyyy} ${HH}:${min}`;
            
            // Always update local history immediately for a smooth demo
            const newTransaction = {
              id: 'temp-' + Date.now(),
              count: finalVerified,
              amount: finalTotal,
              date: dateStr,
              rawDate: now.toISOString(),
              buyerName: buyerName
            };
            
            setHistory(h => {
              const updated = [newTransaction, ...h];
              // Save to localStorage so they don't disappear on navigation
              localStorage.setItem('sim_transactions_history', JSON.stringify(updated.filter(item => item.id.startsWith('temp-'))));
              return updated;
            });

            // Attempt to save to Supabase in the background
            supabase.from('transactions').insert({
              buyer_id: validBuyerId,
              seller_id: validSellerId,
              quantity: finalVerified,
              total_price: finalTotal
            }).select('id').single().then(({ data, error }) => {
              if (error) {
                console.warn("Supabase insert error:", error.message);
                alert("Database Error: " + error.message);
              } else if (data) {
                // Remove from local history to avoid duplicates on next page load
                const localStr = localStorage.getItem('sim_transactions_history');
                if (localStr) {
                  try {
                    let localHistory = JSON.parse(localStr);
                    localHistory = localHistory.filter((item: any) => item.id !== newTransaction.id);
                    localStorage.setItem('sim_transactions_history', JSON.stringify(localHistory));
                  } catch(e) {}
                }
              }
            });
            }

            return target;
          }
          return prev + 1;
        });
      }, 50);
    }
    return () => clearInterval(interval);
  }, [isRunning, target, sellerId, pricePerPiece, buyerName]);

  const handleNewTransaction = () => {
    if (!isRunning && target > 0) {
      setCounted(0);
      setVerification({ ...verification, show: false });
      setIsRunning(true);
    }
  };

  const handleClear = () => {
    setCounted(0);
    setVerification({ ...verification, show: false });
    setIsRunning(false);
    setTargetStr('');
    setPriceStr('');
  };

  const handleDone = () => {
    // Return to the landing page for the next customer
    router.replace('/');
  };

  const handleDeleteHistory = async (id: string) => {
    if (id.startsWith('temp-')) {
      // It's a local simulation transaction
      setHistory(prev => {
        const updated = prev.filter(item => item.id !== id);
        localStorage.setItem('sim_transactions_history', JSON.stringify(updated.filter(item => item.id.startsWith('temp-'))));
        return updated;
      });
    } else {
      await supabase.from('transactions').delete().eq('id', id);
      setHistory(prev => prev.filter(item => item.id !== id));
    }
  };

  return (
    <div className="w-full h-full p-4 flex flex-col font-roboto text-black bg-white">
      {/* Top Header */}
      <div className="flex flex-row justify-between items-center bg-[#D9D9D9] rounded-2xl px-6 py-4 mb-4">
        <div className="flex flex-row items-center">
          <ProfileAvatar imageUrl={sellerPicUrl || undefined} />
          <span className="font-bold text-3xl text-black ml-2 mr-4">{sellerName}</span>
          
          <FishAnimation isRunning={isRunning} />
          
          <ProfileAvatar imageUrl={buyerPicUrl || undefined} className="ml-4" />
          <span className="font-bold text-3xl text-black ml-2">{buyerName}</span>
        </div>
        <div className="flex flex-row items-center">
          <span className="font-bold text-2xl text-black mr-6">{timeStr}</span>
          <button 
            className="bg-[#BA2A23] py-3 px-8 rounded-lg text-white font-bold text-xl hover:bg-[#9a211a] transition-colors"
            onClick={handleDone}
          >
            DONE
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 gap-3 overflow-hidden w-full">
        {/* Left Column: LIVE COUNT */}
        <div className="bg-[#8C8885] rounded-xl p-4 flex flex-col w-full lg:w-[45%] shrink-0">
          <h2 className="font-bold text-white text-xl mb-2">LIVE COUNT</h2>
          
          <div className="bg-[#E8E8E8] rounded-lg items-center justify-center flex flex-col py-4 mb-2 flex-1 max-h-[220px]">
            <span className="font-bold text-[88px] text-black leading-[90px]">
              {String(counted).padStart(4, '0')}
            </span>
            <span className="font-bold text-2xl text-black mt-1">Fingerlings</span>
          </div>
          
          <div className="h-[2px] bg-white my-3" />
          
          <div className="flex flex-row justify-between items-center mb-2">
            <span className="font-bold text-white text-2xl">Target:</span>
            <input 
              className={`font-bold text-white text-2xl text-right border-2 border-white rounded px-2 w-28 h-10 ${isRunning ? 'bg-[#9a9794] opacity-80 border-transparent' : 'bg-transparent'}`}
              value={targetStr}
              onChange={e => setTargetStr(e.target.value)}
              type="number"
              disabled={isRunning}
              maxLength={5}
              placeholder="0"
            />
          </div>
          <div className="flex flex-row justify-between items-center mb-2">
            <span className="font-bold text-white text-2xl">Price per piece:</span>
            <input 
              className={`font-bold text-white text-2xl text-right border-2 border-white rounded px-2 w-28 h-10 ${isRunning ? 'bg-[#9a9794] opacity-80 border-transparent' : 'bg-transparent'}`}
              value={priceStr}
              onChange={e => setPriceStr(e.target.value)}
              type="number"
              disabled={isRunning}
              maxLength={5}
              placeholder="0"
            />
          </div>
          <div className="flex flex-row justify-between items-center mb-2">
            <span className="font-bold text-white text-2xl">Total:</span>
            <span className="font-bold text-white text-2xl">₱ {total.toFixed(2)}</span>
          </div>
          
          <div className="h-[2px] bg-white my-3" />
          
          <div className="flex flex-row justify-between mt-auto mb-1 gap-4">
            <button 
              className={`bg-[#BA2A23] py-3 rounded-lg flex-1 text-white font-bold text-2xl text-center ${isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#9a211a]'}`}
              onClick={handleClear}
              disabled={isRunning}
            >
              Clear
            </button>
            <button 
              className={`bg-[#0EA40E] py-3 rounded-lg flex-1 text-white font-bold text-2xl text-center ${isRunning ? 'opacity-70 cursor-not-allowed' : 'hover:bg-[#0b800b]'}`}
              onClick={handleNewTransaction}
              disabled={isRunning}
            >
              {isRunning ? 'Counting...' : (verification.show ? 'New Transaction' : 'Count')}
            </button>
          </div>
        </div>

        {/* Right Column: Verification Details + History */}
        <div className="flex flex-col flex-1 gap-3 overflow-hidden">
          {/* Verification Details */}
          <div className="bg-[#8C8885] rounded-xl p-5 flex flex-col shrink-0 h-[220px]">
            <h2 className="font-bold text-white text-2xl mb-4">COUNTING VERIFICATION DETAILS</h2>
            <div className="flex flex-row justify-between flex-1 gap-3">
              <div className={`flex-1 h-full bg-[#E8E8E8] border-4 rounded-lg px-1 py-1 flex items-center justify-center relative ${verification.show ? (verification.vision === verification.final ? 'border-[#3ce83c]' : 'border-[#e83c3c]') : 'border-transparent'}`}>
                <span className="font-bold text-lg text-black absolute top-2 left-3">Vision</span>
                <span className="font-bold text-6xl text-black mt-6">{verification.show ? verification.vision : '---'}</span>
              </div>
              <div className={`flex-1 h-full bg-[#E8E8E8] border-4 rounded-lg px-1 py-1 flex items-center justify-center relative ${verification.show ? (verification.sensor3 === verification.final ? 'border-[#3ce83c]' : 'border-[#e83c3c]') : 'border-transparent'}`}>
                <span className="font-bold text-lg text-black absolute top-2 left-3">Sensor 3</span>
                <span className="font-bold text-6xl text-black mt-6">{verification.show ? verification.sensor3 : '---'}</span>
              </div>
              <div className={`flex-1 h-full bg-[#E8E8E8] border-4 rounded-lg px-1 py-1 flex items-center justify-center relative ${verification.show ? (verification.thermal === verification.final ? 'border-[#3ce83c]' : 'border-[#e83c3c]') : 'border-transparent'}`}>
                <span className="font-bold text-lg text-black absolute top-2 left-3">Thermal</span>
                <span className="font-bold text-6xl text-black mt-6">{verification.show ? verification.thermal : '---'}</span>
              </div>
              <div className={`flex-1 h-full rounded-lg px-1 py-1 flex items-center justify-center relative ${verification.show ? 'bg-[#3ce83c]' : 'bg-[#A9A5A2]'}`}>
                <span className="font-bold text-lg text-black absolute top-2 left-3">Final</span>
                <span className="font-bold text-[72px] text-black mt-6">{verification.show ? verification.final : '---'}</span>
              </div>
            </div>
          </div>

          {/* History Panel */}
          <div className="bg-[#8C8885] rounded-xl p-5 flex flex-col flex-1 overflow-hidden">
            <h2 className="font-bold text-white text-2xl mb-4">DAILY TRANSACTION HISTORY</h2>
            <div className="flex-1 overflow-y-auto no-scrollbar pr-2">
              {history.map((item, index) => (
                <div key={item.id} className="group relative flex flex-row bg-[#E8E8E8] rounded-lg mb-3 overflow-hidden items-center py-3">
                  <div className="bg-[#BA2A23] w-8 h-8 rounded-full flex items-center justify-center m-4 shrink-0">
                    <span className="font-bold text-white text-base">{history.length - index}</span>
                  </div>
                  <div className="flex-1 px-2">
                    <div className="flex flex-row justify-around mb-2">
                      <span className="font-bold text-base text-black">TO</span>
                      <span className="font-bold text-base text-black">COUNT</span>
                      <span className="font-bold text-base text-black">AMOUNT</span>
                    </div>
                    <div className="flex flex-row justify-around items-center">
                      <span className="font-bold text-4xl text-[#0088ff]">{item.buyerName || 'Buyer'}</span>
                      <span className="font-bold text-4xl text-[#1eb81e]">{item.count}</span>
                      <span className="font-bold text-4xl text-[#d0c326]">₱ {parseFloat(item.amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="font-bold text-center text-lg text-[#666666] mt-3">
                      {item.date}
                    </div>
                  </div>
                  <button 
                    className="absolute right-0 top-0 bottom-0 w-28 bg-[#BA2A23] text-white font-bold translate-x-full group-hover:translate-x-0 transition-transform duration-300 flex items-center justify-center text-xl"
                    onClick={() => handleDeleteHistory(item.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
              <div className="font-bold text-center text-[#666666] text-2xl mt-6 mb-4">
                Old entries in app
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardScreen() {
  return (
    <Suspense fallback={<div className="w-full h-full bg-white flex items-center justify-center">Loading...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
