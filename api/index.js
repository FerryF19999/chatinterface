// Vercel Serverless API Handler
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// In-memory state (note: Vercel serverless is stateless, use external DB for production)
const AGENTS = [
  { id: 'yuri', name: 'Yuri', color: '#FF6B6B', avatar: '👨‍🚀', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'jarvis', name: 'Jarvis', color: '#4ECDC4', avatar: '🤖', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'friday', name: 'Friday', color: '#45B7D1', avatar: '👩‍💼', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'glass', name: 'Glass', color: '#96CEB4', avatar: '🔍', status: 'offline', lastActivity: null, currentTask: null },
  { id: 'epstein', name: 'Epstein', color: '#DDA0DD', avatar: '🧠', status: 'offline', lastActivity: null, currentTask: null }
];

// Initialize agent states
let agentStates = {};
AGENTS.forEach(agent => {
  agentStates[agent.id] = { ...agent };
});

let chatMessages = [];
let activities = [];

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
    toAgentId,
    content,
    messageType,
    timestamp: new Date(),
    read: false
  };
  chatMessages.push(message);
  if (chatMessages.length > 500) chatMessages.shift();
  
  const fromAgent = agentStates[fromAgentId];
  const targetName = toAgentId ? agentStates[toAgentId]?.name : 'everyone';
  addActivity(fromAgentId, 'message', `Sent message to ${targetName}`, { messageId: message.id });
  
  return message;
}

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Initialize endpoint
app.get('/api/init', (req, res) => {
  res.json({
    agents: Object.values(agentStates),
    messages: chatMessages.slice(-50),
    activities: activities.slice(-20)
  });
});

// Agent login
app.post('/api/agents/:id/login', (req, res) => {
  const { id } = req.params;
  if (agentStates[id]) {
    agentStates[id].status = 'online';
    agentStates[id].lastActivity = new Date();
    addActivity(id, 'login', `${agentStates[id].name} is now online`);
    res.json(agentStates[id]);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Agent logout
app.post('/api/agents/:id/logout', (req, res) => {
  const { id } = req.params;
  if (agentStates[id]) {
    agentStates[id].status = 'offline';
    agentStates[id].currentTask = null;
    addActivity(id, 'logout', `${agentStates[id].name} went offline`);
    res.json(agentStates[id]);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Update agent status
app.put('/api/agents/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, task } = req.body;
  
  if (agentStates[id]) {
    if (status) agentStates[id].status = status;
    if (task !== undefined) agentStates[id].currentTask = task;
    agentStates[id].lastActivity = new Date();
    
    if (task) {
      addActivity(id, 'task', `Working on: ${task}`);
    }
    
    res.json(agentStates[id]);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Get all agents
app.get('/api/agents', (req, res) => {
  res.json(Object.values(agentStates));
});

// Get single agent
app.get('/api/agents/:id', (req, res) => {
  const agent = agentStates[req.params.id];
  if (agent) {
    res.json(agent);
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Get messages
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

// Send message
app.post('/api/messages', (req, res) => {
  const { fromAgentId, toAgentId, content, messageType = 'text' } = req.body;
  
  if (!agentStates[fromAgentId]) {
    return res.status(400).json({ error: 'Invalid fromAgentId' });
  }
  
  const message = addMessage(fromAgentId, toAgentId, content, messageType);
  res.status(201).json(message);
});

// Mark message as read
app.put('/api/messages/:id/read', (req, res) => {
  const msg = chatMessages.find(m => m.id === req.params.id);
  if (msg) {
    msg.read = true;
    res.json(msg);
  } else {
    res.status(404).json({ error: 'Message not found' });
  }
});

// Get activities
app.get('/api/activities', (req, res) => {
  const { limit = 20 } = req.query;
  res.json(activities.slice(0, parseInt(limit)));
});

// Add activity
app.post('/api/activities', (req, res) => {
  const { agentId, type, description, metadata } = req.body;
  const activity = addActivity(agentId, type, description, metadata);
  res.status(201).json(activity);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    agentsOnline: Object.values(agentStates).filter(a => a.status === 'online').length
  });
});

// Also support /health directly
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    agentsOnline: Object.values(agentStates).filter(a => a.status === 'online').length
  });
});

// Export for Vercel
module.exports = app;
