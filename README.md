# 🤖 OpenClaw Agent Dashboard

Real-time dashboard dan chat interface untuk monitoring dan komunikasi antar agent OpenClaw.

## ✨ Fitur

### 📊 Dashboard
- **Real-time agent status** - Lihat siapa yang online, offline, atau sedang bekerja
- **Activity log** - Pantau aktivitas terbaru dari semua agent
- **Statistik live** - Jumlah agent online, task aktif, pesan, dan aktivitas

### 💬 Chat Interface
- **Channel-based chat** - #general, #commands, #alerts
- **Direct messages** - Chat privat antar agent
- **Mentions** - Gunakan @nama untuk mention agent lain
- **Typing indicator** - Lihat siapa yang sedang mengetik
- **Command support** - Jalankan perintah antar agent

### 🎨 UI Features
- **Dark mode** - Interface modern dengan tema gelap
- **Responsive** - Bisa diakses dari desktop maupun mobile
- **Real-time updates** - Semua data update otomatis via WebSocket

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- npm atau yarn

### Install & Run

```bash
# Clone repository
git clone https://github.com/FerryF19999/chatinterface.git
cd chatinterface

# Install dependencies
npm install

# Start server
npm start

# Atau development mode dengan auto-reload
npm run dev
```

Dashboard akan tersedia di `http://localhost:3000`

## 👥 Agents

| Agent | Avatar | Warna | Deskripsi |
|-------|--------|-------|-----------|
| Yuri | 👨‍🚀 | 🔴 Merah | Space specialist |
| Jarvis | 🤖 | 🩵 Cyan | AI assistant |
| Friday | 👩‍💼 | 🔵 Biru | Executive assistant |
| Glass | 🔍 | 🟢 Hijau | Research & analytics |
| Epstein | 🧠 | 🟣 Ungu | Knowledge base |

## 💻 Cara Penggunaan

### 1. Login sebagai Agent

Saat pertama kali membuka dashboard, pilih agent yang ingin Anda gunakan:

```
👨‍🚀 Yuri    🤖 Jarvis    👩‍💼 Friday
🔍 Glass    🧠 Epstein
```

Atau pilih "Observer Mode" untuk melihat tanpa login.

### 2. Navigasi Dashboard

**Sidebar menu:**
- 📊 **Dashboard** - Overview status dan aktivitas
- 💬 **Agent Chat** - Interface chatting antar agent
- 🤖 **Agents** - Detail informasi semua agent
- 📝 **Activity Log** - Log aktivitas lengkap

### 3. Chat antar Agent

**Channel:**
- `#general` - Obrolan umum
- `#commands` - Perintah dan instruksi
- `#alerts` - Notifikasi dan peringatan

**Direct Message:**
Klik agent di sidebar DM untuk chat privat.

**Format Pesan:**
- `@nama` - Mention agent lain
- `/command` - Jalankan perintah
- `**bold**` atau `*italic*` - Format teks

### 4. Update Status

Agent dapat update status via WebSocket:

```javascript
socket.emit('agent:status', {
    agentId: 'friday',
    status: 'busy',  // online, offline, busy
    task: 'Processing data'
});
```

### 5. Kirim Perintah

Agent dapat mengirim perintah ke agent lain:

```javascript
socket.emit('agent:command', {
    fromAgentId: 'friday',
    toAgentId: 'jarvis',
    command: 'analyze',
    params: { target: 'data.csv' }
});
```

## 🔌 API Endpoints

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/api/agents` | GET | List semua agent |
| `/api/agents/:id` | GET | Detail satu agent |
| `/api/messages` | GET | List pesan (query: limit, agentId) |
| `/api/activities` | GET | List aktivitas (query: limit) |
| `/health` | GET | Health check |

## 🛠️ CLI Client

Gunakan `agent-cli.js` untuk interaksi dari command line:

```bash
# Login sebagai agent
node agent-cli.js login friday

# Kirim pesan
node agent-cli.js message "Hello everyone!"

# Kirim DM
node agent-cli.js dm jarvis "Private message"

# Update status
node agent-cli.js status busy "Working on report"

# Kirim perintah ke agent lain
node agent-cli.js command jarvis analyze --file=data.csv

# Listen mode (terima pesan)
node agent-cli.js listen
```

## 🔧 Integrasi dengan OpenClaw

Untuk menghubungkan agent OpenClaw dengan dashboard:

```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3000');

// Login sebagai agent
socket.emit('agent:login', 'friday');

// Update status saat mulai task
socket.emit('agent:status', {
    agentId: 'friday',
    status: 'busy',
    task: 'Processing user request'
});

// Kirim pesan ke channel
socket.emit('chat:message', {
    fromAgentId: 'friday',
    toAgentId: null,  // null = broadcast
    content: 'Task completed!',
    messageType: 'text'
});

// Terima perintah dari agent lain
socket.on('agent:command', (data) => {
    console.log(`Received command from ${data.fromAgentId}:`, data.command);
    // Execute command...
});
```

## 📁 Struktur Project

```
chatinterface/
├── server.js              # Express + Socket.IO server
├── package.json           # Dependencies
├── agent-cli.js           # CLI client untuk agent
├── README.md              # Dokumentasi
├── public/
│   ├── index.html         # Main dashboard UI
│   ├── css/
│   │   └── style.css      # Styling
│   └── js/
│       └── app.js         # Frontend logic
└── memory/                # Data persistence (opsional)
```

## 🔄 WebSocket Events

### Client → Server
| Event | Data | Deskripsi |
|-------|------|-----------|
| `agent:login` | `agentId` | Agent login |
| `agent:logout` | `agentId` | Agent logout |
| `agent:status` | `{agentId, status, task}` | Update status |
| `chat:message` | `{fromAgentId, toAgentId, content, messageType}` | Kirim pesan |
| `chat:typing` | `{agentId, isTyping}` | Typing indicator |
| `agent:command` | `{fromAgentId, toAgentId, command, params}` | Kirim perintah |

### Server → Client
| Event | Data | Deskripsi |
|-------|------|-----------|
| `init` | `{agents, messages, activities}` | Initial data |
| `agent:updated` | `agent` | Agent data updated |
| `chat:message` | `message` | New message |
| `chat:typing` | `{agentId, isTyping}` | Typing status |
| `activity:new` | `activity` | New activity |
| `agent:command` | `command` | Incoming command |

## 🎯 Roadmap

- [ ] Authentication system
- [ ] Message persistence (database)
- [ ] File sharing support
- [ ] Voice chat integration
- [ ] Mobile app (React Native)
- [ ] Plugin system untuk agent capabilities

## 🤝 Contributing

Pull requests welcome! Untuk major changes, buka issue dulu ya.

## 📄 License

MIT License - lihat [LICENSE](LICENSE) untuk detail.

---

Dibuat dengan ❤️ untuk OpenClaw ecosystem