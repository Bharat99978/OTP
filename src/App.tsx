import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { QrCode, Smartphone, LogOut, Send, Loader2, CheckCircle2, Download } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let socket: Socket;

export default function App() {
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'pairing'>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingMode, setPairingMode] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  
  const [targetNumber, setTargetNumber] = useState('+919322461670');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    socket = io();

    socket.on('state', (state) => {
      setConnectionState(state);
      if (state === 'connected') {
        setPairingCode(null);
        setQrCode(null);
      }
    });

    socket.on('qr', (url) => {
      setQrCode(url);
    });

    socket.on('pairing-code', (code) => {
      // Baileys pairing code format typically is something like 'ABCD-EFGH'
      setPairingCode(code);
    });

    socket.on('error-msg', (msg) => {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 5000);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleStart = () => {
    if (connectionState === 'disconnected') {
       socket.emit('start');
    }
  };

  const handleRequestPairing = () => {
    if (!phoneNumber) {
      setErrorMsg('Please enter your WhatsApp phone number to link.');
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }
    socket.emit('request-pairing', phoneNumber);
  };

  const handleLogout = () => {
    socket.emit('logout');
  };

  const handleSendOTP = async () => {
    if (!targetNumber) return;
    setIsSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetNumber }),
      });
      const data = await res.json();
      if (data.success) {
        setSendResult({ success: true, message: data.message + ` (OTP: ${data.otp})` });
      } else {
        setSendResult({ success: false, message: data.error || 'Failed to send OTP' });
      }
    } catch (err: any) {
      setSendResult({ success: false, message: err.message });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-4 font-sans text-slate-800">
      <div className="w-full max-w-xl bg-white shadow-xl rounded-2xl overflow-hidden border border-slate-100">
        
        {/* Header */}
        <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">WhatsApp OTP Bot</h1>
            <p className="text-slate-400 text-sm mt-0.5">Automated messaging using Baileys</p>
          </div>
          <div className="flex items-center space-x-2">
            <span className="relative flex h-3 w-3">
              {(connectionState === 'connecting' || connectionState === 'pairing') && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
              )}
              <span className={cn(
                "relative inline-flex rounded-full h-3 w-3",
                connectionState === 'connected' ? 'bg-green-500' :
                (connectionState === 'connecting' || connectionState === 'pairing') ? 'bg-yellow-500' : 'bg-red-500'
              )}></span>
            </span>
            <span className="text-sm font-medium capitalize text-slate-300">
              {connectionState}
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="m-6 mb-0 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
            {errorMsg}
          </div>
        )}

        {/* Content Area */}
        <div className="p-6">
          
          {/* DISCONNECTED / CONNECTING / PAIRING LOGIC */}
          {connectionState !== 'connected' && (
            <div className="space-y-6">
              
              <div className="text-center pb-4 border-b border-slate-100">
                <h2 className="text-lg font-medium text-slate-900 mb-2">Connect Your Account</h2>
                <p className="text-slate-500 text-sm">
                  Start the engine to generate a QR code or pair your phone code to start sending automated OTPs.
                </p>
              </div>

              {connectionState === 'disconnected' && (
                <button
                  onClick={handleStart}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
                >
                  Start WhatsApp Client
                </button>
              )}

              {(connectionState === 'connecting' || connectionState === 'pairing') && (
                <div className="flex flex-col items-center justify-center py-6 space-y-6">
                  
                  {/* Mode Toggles */}
                  <div className="flex bg-slate-100 p-1 rounded-lg w-full max-w-sm">
                    <button
                      onClick={() => setPairingMode(false)}
                      className={cn("flex-1 py-1.5 text-sm font-medium rounded-md transition-shadow", !pairingMode ? 'bg-white shadow text-slate-900' : 'text-slate-500')}
                    >
                      Scan QR Code
                    </button>
                    <button
                      onClick={() => setPairingMode(true)}
                      className={cn("flex-1 py-1.5 text-sm font-medium rounded-md transition-shadow", pairingMode ? 'bg-white shadow text-slate-900' : 'text-slate-500')}
                    >
                      Pairing Code
                    </button>
                  </div>

                  {!pairingMode ? (
                    // QR MODE
                    <div className="flex flex-col items-center">
                      {qrCode ? (
                        <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
                          <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
                        </div>
                      ) : (
                        <div className="w-64 h-64 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center text-slate-400">
                          <Loader2 className="w-8 h-8 animate-spin mb-3 text-blue-500" />
                          <p className="text-sm font-medium">Generating QR...</p>
                        </div>
                      )}
                      <p className="text-sm text-slate-500 mt-4 text-center">
                        Open WhatsApp on your phone &gt; Linked Devices &gt; Link a Device
                      </p>
                    </div>
                  ) : (
                    // PAIRING CODE MODE
                    <div className="w-full max-w-sm space-y-4">
                       {!pairingCode ? (
                         <>
                           <div>
                             <label className="block text-sm font-medium text-slate-700 mb-1">
                               Your WhatsApp Number
                             </label>
                             <div className="relative">
                               <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                 <Smartphone className="h-5 w-5 text-slate-400" />
                               </div>
                               <input
                                 type="text"
                                 value={phoneNumber}
                                 onChange={(e) => setPhoneNumber(e.target.value)}
                                 placeholder="+1 234 567 8900"
                                 className="pl-10 w-full rounded-xl border border-slate-300 px-4 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                               />
                             </div>
                           </div>
                           <button
                             onClick={handleRequestPairing}
                             disabled={connectionState === 'pairing' && !!pairingCode}
                             className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                           >
                             Get Pairing Code
                           </button>
                           <p className="text-xs text-slate-500 text-center">
                             After requesting, wait a few seconds. Open WhatsApp &gt; Linked Devices &gt; Link with phone number instead.
                           </p>
                         </>
                       ) : (
                         <div className="text-center p-6 border rounded-2xl border-blue-100 bg-blue-50/50">
                           <p className="text-sm text-slate-600 font-medium mb-3">Enter this code on your phone</p>
                           <div className="text-4xl font-bold tracking-[0.25em] text-slate-900 font-mono">
                             {pairingCode}
                           </div>
                         </div>
                       )}
                    </div>
                  )}

                  <button
                    onClick={handleLogout}
                    className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center space-x-1"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Cancel connection</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* CONNECTED LOGIC */}
          {connectionState === 'connected' && (
            <div className="space-y-8">
              
              <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-xl">
                 <div className="flex items-center space-x-3 text-green-800">
                    <CheckCircle2 className="w-5 h-5" />
                    <div>
                      <p className="font-medium">Bot is Active & Ready</p>
                      <p className="text-xs text-green-600/80">You can now dispatch OTP messages via API.</p>
                    </div>
                 </div>
                 <button 
                  onClick={handleLogout}
                  className="px-3 py-1.5 text-sm bg-white border border-green-200 text-green-700 hover:bg-green-100 rounded-lg font-medium transition-colors"
                 >
                   Logout
                 </button>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                <h3 className="text-sm font-bold tracking-wide text-slate-500 uppercase mb-4">
                  External API Integration
                </h3>
                <div className="space-y-3 font-mono text-xs">
                  <p className="text-slate-600 font-sans text-sm">
                    Use this endpoint from your external HTML sites. CORS is fully enabled.
                  </p>
                  
                  <div className="bg-slate-900 text-slate-300 p-4 rounded-xl overflow-x-auto">
                    <div className="text-slate-500 mb-2">{'// POST Example'}</div>
                    <code className="text-green-400">fetch</code>
                    <span>{'("'}</span>
                    <span className="text-blue-300">{window.location.origin}/api/send-otp</span>
                    <span>{'", {'}</span>
                    <br />
                    <span>&nbsp;&nbsp;</span>
                    <code className="text-rose-300">method</code>
                    <span>{': "POST",'}</span>
                    <br />
                    <span>&nbsp;&nbsp;</span>
                    <code className="text-rose-300">headers</code>
                    <span>{': { "Content-Type": "application/json" },'}</span>
                    <br />
                    <span>&nbsp;&nbsp;</span>
                    <code className="text-rose-300">body</code>
                    <span>{': JSON.stringify({ targetNumber: "+919322461670" })'}</span>
                    <br />
                    <span>{'}).then(res => res.json()).then(console.log);'}</span>
                  </div>

                  <div className="bg-slate-900 text-slate-300 p-4 rounded-xl overflow-x-auto mt-2">
                    <div className="text-slate-500 mb-2">{'// GET Example (Direct URL / Image Pixel)'}</div>
                    <code className="text-green-400">fetch</code>
                    <span>{'("'}</span>
                    <span className="text-blue-300">{window.location.origin}/api/send-otp?targetNumber=+919322461670&amp;message=Hello! Your OTP is {"{{"}otp{"}}"}</span>
                    <span>{'")'}</span>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-200 mt-4">
                    <a 
                      href="/api/download-sample"
                      download
                      className="inline-flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-xl font-medium transition-colors text-sm w-full justify-center"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Sample HTML Client</span>
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                <h3 className="text-sm font-bold tracking-wide text-slate-500 uppercase mb-4">
                  Send OTP Message Manually
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Target Phone Number</label>
                    <input
                      type="text"
                      value={targetNumber}
                      onChange={(e) => setTargetNumber(e.target.value)}
                      placeholder="+91..."
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm"
                    />
                  </div>

                  <button
                    onClick={handleSendOTP}
                    disabled={isSending || !targetNumber}
                    className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    {isSending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Send OTP</span>
                      </>
                    )}
                  </button>

                  {sendResult && (
                    <div className={cn(
                      "p-4 rounded-xl text-sm font-medium border",
                      sendResult.success 
                        ? "bg-green-50 border-green-200 text-green-800" 
                        : "bg-red-50 border-red-200 text-red-800"
                    )}>
                      {sendResult.message}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}

