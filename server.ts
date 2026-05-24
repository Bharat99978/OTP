import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import baileys, { useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';

// @ts-ignore - baileys default export handling
const makeWASocket = baileys.default || baileys;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = 3000;

app.use(cors());
app.use(express.json());

// State variables
let sock: any = null;
let qrDataURL: string | null = null;
let connectionState: 'disconnected' | 'connecting' | 'connected' | 'pairing' = 'disconnected';
let pairingCodeRequested = false;
let retryCount = 0;

// Delete auth state if user requests a full reset
function clearAuthState() {
  const targetDir = path.resolve(process.cwd(), 'auth_info_baileys');
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

async function startWhatsApp() {
  if (connectionState === 'connecting' || connectionState === 'connected') return;
  connectionState = 'connecting';
  io.emit('state', connectionState);

  const targetDir = path.resolve(process.cwd(), 'auth_info_baileys');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(targetDir);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }) as any,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    // Using Windows/Chrome to seem more like WhatsApp Web
    browser: ['Windows', 'Chrome', '111.0.0.0'] 
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !pairingCodeRequested) {
      qrcode.toDataURL(qr, (err, url) => {
        if (!err) {
          qrDataURL = url;
          io.emit('qr', url);
        }
      });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const isFatal = statusCode === DisconnectReason.loggedOut || statusCode === 403;
      const shouldReconnect = !isFatal;
      connectionState = 'disconnected';
      io.emit('state', connectionState);
      
      console.log('Connection closed. statusCode:', statusCode, 'reconnect:', shouldReconnect);
      
      if (statusCode === 403) {
         io.emit('error-msg', 'WhatsApp Account in Review or Banned (403). Automatically stopped.');
      }
      
      if (shouldReconnect && retryCount < 5) {
        retryCount++;
        const delay = Math.min(5000 * retryCount, 30000); // 5s, 10s... max 30s
        console.log(`Reconnecting in ${delay/1000}s... (Attempt ${retryCount})`);
        
        setTimeout(() => {
          startWhatsApp();
        }, delay);
      } else {
        if (retryCount >= 5) {
            io.emit('error-msg', 'Max connection retries reached. Please restart manually.');
        }
        clearAuthState();
        qrDataURL = null;
        pairingCodeRequested = false;
        sock = null;
        retryCount = 0;
        io.emit('qr', null);
      }
    } else if (connection === 'open') {
      connectionState = 'connected';
      qrDataURL = null;
      pairingCodeRequested = false;
      retryCount = 0;
      io.emit('state', connectionState);
      io.emit('qr', null);
      console.log('WhatsApp connected successfully!');
    }
  });
}

// Check for existing session and start on boot
const credsPath = path.join(process.cwd(), 'auth_info_baileys', 'creds.json');
if (fs.existsSync(credsPath)) {
  console.log('Existing credentials found, auto-starting WhatsApp...');
  startWhatsApp();
}

// Socket.io for Realtime UI Updates
io.on('connection', (socket) => {
  socket.emit('state', connectionState);
  if (qrDataURL) socket.emit('qr', qrDataURL);

  socket.on('start', () => {
    startWhatsApp();
  });

  socket.on('logout', async () => {
    if (sock && connectionState === 'connected') {
      await sock.logout();
    } else {
      clearAuthState();
      connectionState = 'disconnected';
      qrDataURL = null;
      pairingCodeRequested = false;
      sock = null;
      io.emit('state', connectionState);
      io.emit('qr', null);
    }
  });

  socket.on('request-pairing', async (phoneNumber: string) => {
    if (!sock) {
      socket.emit('error-msg', 'WhatsApp client not initialized. Call start first.');
      return;
    }
    if (connectionState === 'connected') {
       socket.emit('error-msg', 'Already connected.');
       return;
    }
    
    // Formatting phone number
    const formattedPhone = phoneNumber.replace(/[^0-9]/g, '');
    try {
      pairingCodeRequested = true;
      connectionState = 'pairing';
      io.emit('state', connectionState);
      
      // Delay before requesting pairing code (recommended by Baileys)
      setTimeout(async () => {
         try {
            const code = await sock.requestPairingCode(formattedPhone);
            socket.emit('pairing-code', code);
         } catch (err: any) {
            socket.emit('error-msg', 'Failed to generate code: ' + err.message);
            pairingCodeRequested = false;
            connectionState = Object.keys(sock?.authState?.creds?.me || {}).length ? 'connected' : 'connecting';
            io.emit('state', connectionState);
         }
      }, 2000);
    } catch (err: any) {
      socket.emit('error-msg', err.message);
      pairingCodeRequested = false;
    }
  });
});

// API Routes
app.all('/api/send-otp', async (req, res) => {
  if (connectionState !== 'connected' || !sock) {
     res.status(400).json({ error: 'WhatsApp is not connected.' });
     return;
  }

  // Support both GET query and POST body
  let targetNumber = req.body?.targetNumber || req.query?.targetNumber;
  let customMessage = req.body?.message || req.query?.message;
  
  if (!targetNumber) {
     res.status(400).json({ error: 'targetNumber is required.' });
     return;
  }

  // Format to JID (WhatsApp ID)
  const jid = `${String(targetNumber).replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  const otp = Math.floor(100000 + Math.random() * 900000);
  const textMessage = customMessage ? String(customMessage).replace('{{otp}}', otp.toString()) : `Your OTP is: ${otp}`;

  try {
    // Simulate typing to reduce ban risk
    await sock.presenceSubscribe(jid);
    await new Promise(r => setTimeout(r, 500));
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, 1500));
    await sock.sendPresenceUpdate('paused', jid);

    await sock.sendMessage(jid, { text: textMessage });
    res.json({ success: true, message: `Message sent successfully to ${targetNumber}`, otp });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/download-sample', (req, res) => {
  const hostUrl = `${req.protocol}://${req.get('host')}`;
  
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Send OTP via WhatsApp</title>
    <style>
        body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f1f5f9; margin: 0; }
        .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); width: 100%; max-w: 400px; }
        h2 { margin-top: 0; color: #0f172a; }
        .form-group { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; color: #475569; font-size: 0.875rem; font-weight: 500; }
        input[type="text"], input[type="tel"] { width: 100%; padding: 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box; font-size: 1rem; margin-bottom: 1rem; }
        button { width: 100%; background: #0f172a; color: white; border: none; padding: 0.75rem; border-radius: 8px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #1e293b; }
        button:disabled { background: #94a3b8; cursor: not-allowed; }
        #result { margin-top: 1rem; padding: 0.75rem; border-radius: 8px; display: none; font-size: 0.875rem; }
        .success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    </style>
</head>
<body>
    <div class="card">
        <h2>Send WhatsApp OTP</h2>
        
        <div class="form-group">
            <label>Mobile Number (with Country Code)</label>
            <input type="tel" id="mobile" placeholder="+91..." value="+919322461670">
        </div>
        
        <div class="form-group">
            <label>Custom Message (use {{otp}} for the code)</label>
            <input type="text" id="message" value="Hello! Your verification code is {{otp}}. Do not share it." placeholder="Your code is {{otp}}">
        </div>
        
        <button id="sendBtn" onclick="sendOTP()">Send OTP</button>
        <div id="result"></div>
    </div>

    <script>
        async function sendOTP() {
            const btn = document.getElementById('sendBtn');
            const resultDiv = document.getElementById('result');
            const targetNumber = document.getElementById('mobile').value;
            const message = document.getElementById('message').value;

            if (!targetNumber) {
                showResult('Please enter a mobile number', 'error');
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Sending...';
            resultDiv.style.display = 'none';

            try {
                // Point this to your actual deployed app URL if testing elsewhere
                const apiUrl = "${hostUrl}/api/send-otp"; 
                
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetNumber, message })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showResult(data.message, 'success');
                } else {
                    showResult(data.error || 'Failed to send', 'error');
                }
            } catch (error) {
                showResult('Network error: ' + error.message, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Send OTP';
            }
        }

        function showResult(text, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = text;
            resultDiv.className = type;
            resultDiv.style.display = 'block';
        }
    </script>
</body>
</html>`;

  res.setHeader('Content-disposition', 'attachment; filename=integration-sample.html');
  res.setHeader('Content-type', 'text/html');
  res.write(htmlContent);
  res.end();
});

// Vite Setup for Development and Production
async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

setupVite().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
