const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Agent definitions
const AGENTS = [
  { id: 'yuri', name: 'Yuri', color: '#FF6B6B', avatar: '👨‍🚀', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'jarvis', name: 'Jarvis', color: '#4ECDC4', avatar: '🤖', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'friday', name: 'Friday', color: '#45B7D1', avatar: '👩‍💼', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'glass', name: 'Glass', color: '#96CEB4', avatar: '🔍', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'epstein', name: 'Epstein', color: '#DDA0DD', avatar: '🧠', status: 'offline', lastActivity: null, currentTask: null }
];

// State management
let agentStates = {};
let chatMessages = [];
let activities = [];

// Initialize agent states
AGENTS.forEach(agent => {
  agentStates[agent.id] = { ...agent };
});

// Helper functions
function addActivity(agentId, type, description, metadata = {}) {
  const activity = {
    id: uuidv4(),
    agentId,
    type,
    description,
    timestamp: new Date(),
    metadata
  };
  activities.unshift(activity);
  if (activities.length > 100) activities.pop();
  return activity;
}

function addMessage(fromAgentId, toAgentId, content, messageType = 'text') {
  const message = {
    id: uuidv4(),
    fromAgentId,
    toAgentId, // null for broadcast
    content,
    messageType,
    timestamp: new Date(),
    read: false
  };
  chatMessages.push(message);
  if (chatMessages.length > 500) chatMessages.shift();
  
  // Add activity for the message
  const fromAgent = agentStates[fromAgentId];
  const targetName = toAgentId ? agentStates[toAgentId]?.name : 'everyone';
  addActivity(fromAgentId, 'message', `Sent message to ${targetName}`, { messageId: message.id });
  
  return message;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current state to new client
  socket.emit('init', {
    agents: Object.values(agentStates),
    messages: chatMessages.slice(-50),
    activities: activities.slice(-20)
  });

  // Agent login
  socket.on('agent:login', (agentId) => {
    if (agentStates[agentId]) {
      agentStates[agentId].status = 'online';
      agentStates[agentId].lastActivity = new Date();
      agentStates[agentId].socketId = socket.id;
      
      socket.agentId = agentId;
      
      addActivity(agentId, 'login', `${agentStates[agentId].name} is now online`);
      
      io.emit('agent:updated', agentStates[agentId]);
      io.emit('activity:new', activities[0]);
      
      console.log(`Agent ${agentId} logged in`);
    }
  });

  // Agent logout
  socket.on('agent:logout', (agentId) => {
    if (agentStates[agentId]) {
      agentStates[agentId].status = 'offline';
      agentStates[agentId].currentTask = null;
      delete agentStates[agentId].socketId;
      
      addActivity(agentId, 'logout', `${agentStates[agentId].name} went offline`);
      
      io.emit('agent:updated', agentStates[agentId]);
      io.emit('activity:new', activities[0]);
    }
  });

  // Update agent status/task
  socket.on('agent:status', ({ agentId, status, task }) => {
    if (agentStates[agentId]) {
      if (status) agentStates[agentId].status = status;
      if (task !== undefined) agentStates[agentId].currentTask = task;
      agentStates[agentId].lastActivity = new Date();
      
      if (task) {
        addActivity(agentId, 'task', `Working on: ${task}`);
        io.emit('activity:new', activities[0]);
      }
      
      io.emit('agent:updated', agentStates[agentId]);
    }
  });

  // Send chat message
  socket.on('chat:message', (data) => {
    const { fromAgentId, toAgentId, content, messageType = 'text' } = data;
    
    if (agentStates[fromAgentId]) {
      const message = addMessage(fromAgentId, toAgentId, content, messageType);
      
      // Broadcast to all clients
      io.emit('chat:message', message);
      
      // If direct message, also notify the target agent
      if (toAgentId && agentStates[toAgentId]?.socketId) {
        io.to(agentStates[toAgentId].socketId).emit('chat:direct', message);
      }
    }
  });

  // Mark message as read
  socket.on('chat:read', (messageId) => {
    const msg = chatMessages.find(m => m.id === messageId);
    if (msg) {
      msg.read = true;
      io.emit('chat:read', messageId);
    }
  });

  // Typing indicator
  socket.on('chat:typing', ({ agentId, isTyping }) => {
    socket.broadcast.emit('chat:typing', { agentId, isTyping });
  });

  // Command from agent
  socket.on('agent:command', ({ fromAgentId, toAgentId, command, params }) => {
    addActivity(fromAgentId, 'command', `Executed command: ${command}`, { toAgentId, params });
    
    // Forward command to target agent if specified
    if (toAgentId && agentStates[toAgentId]?.socketId) {
      io.to(agentStates[toAgentId].socketId).emit('agent:command', {
        fromAgentId,
        command,
        params,
        timestamp: new Date()
      });
    }
    
    io.emit('activity:new', activities[0]);
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Mark agent as offline if they were logged in
    if (socket.agentId && agentStates[socket.agentId]) {
      agentStates[socket.agentId].status = 'offline';
      agentStates[socket.agentId].currentTask = null;
      delete agentStates[socket.agentId].socketId;
      
      addActivity(socket.agentId, 'disconnect', `${agentStates[socket.agentId].name} disconnected`);
      
      io.emit('agent:updated', agentStates[socket.agentId]);
      io.emit('activity:new', activities[0]);
    }
  });
});

// REST API endpoints
app.get('/api/agents', (req, res) => {
  res.json(Object.values(agentStates));
});

app.get('/api/agents/:id', (req, res) => {
  const agent = agentStates[req.params.id];
  if (agent) {
    res.json(agent);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.get('/api/messages', (req, res) => {
  const { limit = 50, agentId } = req.query;
  let messages = chatMessages;
  
  if (agentId) {
    messages = messages.filter(m => 
      m.fromAgentId === agentId || m.toAgentId === agentId || m.toAgentId === null
    );
  }
  
  res.json(messages.slice(-parseInt(limit)));
});

app.get('/api/activities', (req, res) => {
  const { limit = 20 } = req.query;
  res.json(activities.slice(0, parseInt(limit)));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    agentsOnline: Object.values(agentStates).filter(a => a.status === 'online').length
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 OpenClaw Agent Dashboard running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
});

module.exports = { app, server, io };