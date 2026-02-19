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

// User profile (Ferry) - Owner with full control
const USERS = {
  ferry: { 
    id: 'ferry', 
    name: 'Ferry', 
    color: '#FFD700', 
    avatar: '👤', 
    status: 'online', 
    isUser: true,
    role: 'owner',
    roleLabel: 'Owner',
    canManageAgents: true,
    canCallAgents: true
  }
};

// State management
let agentStates = {};
let chatMessages = [];
let activities = [];

// Initialize agent states
AGENTS.forEach(agent => {
  agentStates[agent.id] = { ...agent };
});

// Helper to get sender info (agent or user)
function getSenderInfo(senderId) {
  if (USERS[senderId]) return USERS[senderId];
  return agentStates[senderId];
}

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
  const fromSender = getSenderInfo(fromAgentId);
  const targetName = toAgentId ? (getSenderInfo(toAgentId)?.name || toAgentId) : 'everyone';
  const senderName = fromSender?.name || fromAgentId;
  addActivity(fromAgentId, 'message', `${senderName} sent message to ${targetName}`, { messageId: message.id });
  
  return message;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current state to new client
  socket.emit('init', {
    agents: Object.values(agentStates),
    users: USERS,
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

// Initialize endpoint - provides full state including users
app.get('/api/init', (req, res) => {
  res.json({
    agents: Object.values(agentStates),
    users: USERS,
    messages: chatMessages.slice(-50),
    activities: activities.slice(-20)
  });
});

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

// Agent personalities and system prompts
const AGENT_PERSONALITIES = {
  jarvis: {
    name: 'Jarvis',
    personality: 'You are Jarvis, an efficient and professional AI assistant. You are helpful, concise, and focused on productivity. You speak in a formal but friendly manner. You excel at task management, automation, and technical assistance.',
    tone: 'professional and efficient'
  },
  friday: {
    name: 'Friday',
    personality: 'You are Friday, an executive assistant agent. You are organized, detail-oriented, and proactive. You help with scheduling, research, documentation, and general executive tasks. You speak in a warm, professional manner.',
    tone: 'warm and organized'
  },
  glass: {
    name: 'Glass',
    personality: 'You are Glass, a research and analytics specialist. You are analytical, precise, and thorough. You excel at data analysis, research, investigation, and finding patterns. You speak clearly and factually.',
    tone: 'analytical and precise'
  },
  epstein: {
    name: 'Epstein',
    personality: 'You are Epstein, a knowledgeable advisor and intellectual. You enjoy deep discussions, knowledge sharing, and complex problem solving. You are thoughtful, well-read, and enjoy philosophical and intellectual conversations.',
    tone: 'thoughtful and intellectual'
  },
  yuri: {
    name: 'Yuri',
    personality: 'You are Yuri, a space and exploration specialist with an adventurous spirit. You are bold, enthusiastic, and ready for challenges. You speak with energy and are always ready to take on missions.',
    tone: 'enthusiastic and bold'
  }
};

// Call Anthropic API for agent response
async function callAgentAI(agentId, userMessage, userId = 'ferry') {
  const agent = AGENT_PERSONALITIES[agentId];
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const systemPrompt = `${agent.personality}

You are responding to ${userId}. Keep your response concise (2-4 sentences) and in character. Be helpful and engaging. Current user message: "${userMessage}"`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('AI call failed:', error);
    // Fallback response if AI fails
    return `Hello ${userId}! I'm ${agent.name}. I received your message: "${userMessage}". How can I assist you further?`;
  }
}

// Agent command endpoint - allows users to call agents via /agentname command
app.post('/api/agent-command', async (req, res) => {
  const { agentId, command, params, userId = 'ferry' } = req.body;
  
  if (!agentId || !command) {
    return res.status(400).json({ error: 'agentId and command are required' });
  }
  
  // Validate agent exists
  if (!agentStates[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const targetAgent = agentStates[agentId];
  
  // Add activity for the command
  addActivity(agentId, 'command', `Received command from ${userId}: ${command}`, { 
    fromUser: userId, 
    params 
  });
  
  // Add a message showing the command was sent
  const commandMessage = addMessage(userId, agentId, `/${agentId} ${command} ${params || ''}`.trim(), 'command');
  
  // Broadcast the command message
  io.emit('chat:message', commandMessage);
  io.emit('activity:new', activities[0]);
  
  // Call actual AI agent for response
  (async () => {
    try {
      // Get AI response
      const aiResponse = await callAgentAI(agentId, command, userId);
      
      const responseMessage = addMessage(agentId, userId, aiResponse, 'text');
      
      // Broadcast the response
      io.emit('chat:message', responseMessage);
      
      addActivity(agentId, 'message', `Responded to ${userId}'s command`, { 
        command, 
        responseId: responseMessage.id 
      });
      io.emit('activity:new', activities[0]);
    } catch (error) {
      console.error('Agent response error:', error);
      // Send error message
      const errorMessage = addMessage(agentId, userId, `Sorry ${userId}, I encountered an error processing your request. Please try again.`, 'text');
      io.emit('chat:message', errorMessage);
    }
  })();
  
  res.status(202).json({ 
    success: true, 
    message: `Command sent to ${targetAgent.name}`,
    commandId: commandMessage.id
  });
});

// Get available agents for command autocomplete
app.get('/api/agent-commands/list', (req, res) => {
  const commands = Object.values(agentStates).map(agent => ({
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    color: agent.color,
    prefix: `/${agent.id}`
  }));
  
  res.json(commands);
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