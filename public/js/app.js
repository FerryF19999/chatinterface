// OpenClaw Agent Dashboard - Frontend App
class AgentDashboard {
    constructor() {
        this.socket = null;
        this.currentAgent = null;
        this.currentView = 'dashboard';
        this.currentRoom = 'general';
        this.agents = {};
        this.messages = [];
        this.activities = [];
        this.unreadCount = 0;
        this.typingTimeout = null;
        
        this.init();
    }
    
    init() {
        this.connectSocket();
        this.bindEvents();
        this.checkLoginStatus();
    }
    
    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.updateConnectionStatus(true);
            console.log('Connected to server');
        });
        
        this.socket.on('disconnect', () => {
            this.updateConnectionStatus(false);
            console.log('Disconnected from server');
        });
        
        this.socket.on('init', (data) => {
            this.agents = data.agents.reduce((acc, agent) => {
                acc[agent.id] = agent;
                return acc;
            }, {});
            this.messages = data.messages;
            this.activities = data.activities;
            
            this.renderAgents();
            this.renderStats();
            this.renderActivity();
            this.renderMessages();
            this.renderDMList();
        });
        
        this.socket.on('agent:updated', (agent) => {
            this.agents[agent.id] = agent;
            this.renderAgents();
            this.renderStats();
            this.renderDMList();
        });
        
        this.socket.on('chat:message', (message) => {
            this.messages.push(message);
            this.appendMessage(message);
            
            if (message.fromAgentId !== this.currentAgent) {
                this.unreadCount++;
                this.updateBadge();
            }
        });
        
        this.socket.on('chat:typing', ({ agentId, isTyping }) => {
            this.showTypingIndicator(agentId, isTyping);
        });
        
        this.socket.on('activity:new', (activity) => {
            this.activities.unshift(activity);
            if (this.activities.length > 100) this.activities.pop();
            this.prependActivity(activity);
        });
        
        this.socket.on('agent:command', (command) => {
            this.handleIncomingCommand(command);
        });
    }
    
    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.switchView(view);
                
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
        
        // Agent login modal
        document.querySelectorAll('.agent-login-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const agentId = btn.dataset.agent;
                this.loginAs(agentId);
            });
        });
        
        document.getElementById('observer-mode').addEventListener('click', () => {
            this.closeLoginModal();
        });
        
        // Current agent selector
        document.getElementById('current-agent').addEventListener('change', (e) => {
            if (e.target.value) {
                this.loginAs(e.target.value);
            }
        });
        
        // Chat
        document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            } else {
                this.handleTyping();
            }
        });
        
        // Room switching
        document.querySelectorAll('.room-item').forEach(room => {
            room.addEventListener('click', () => {
                document.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
                room.classList.add('active');
                this.currentRoom = room.dataset.room;
                document.getElementById('chat-room-name').textContent = 
                    this.currentRoom === 'general' ? '#general' : 
                    this.currentRoom === 'commands' ? '#commands' : '#alerts';
            });
        });
        
        // Refresh button
        document.getElementById('refresh-btn').addEventListener('click', () => {
            location.reload();
        });
        
        // Toolbar buttons
        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById('message-input');
                const title = btn.getAttribute('title');
                
                if (title === 'Bold') this.wrapText(input, '**');
                else if (title === 'Italic') this.wrapText(input, '*');
                else if (title === 'Code') this.wrapText(input, '`');
                else if (title === 'Command') this.wrapText(input, '/');
            });
        });
    }
    
    checkLoginStatus() {
        const savedAgent = localStorage.getItem('currentAgent');
        if (savedAgent) {
            this.loginAs(savedAgent);
        } else {
            this.showLoginModal();
        }
    }
    
    showLoginModal() {
        document.getElementById('login-modal').classList.remove('hidden');
    }
    
    closeLoginModal() {
        document.getElementById('login-modal').classList.add('hidden');
    }
    
    loginAs(agentId) {
        this.currentAgent = agentId;
        localStorage.setItem('currentAgent', agentId);
        
        document.getElementById('current-agent').value = agentId;
        this.closeLoginModal();
        
        if (this.socket) {
            this.socket.emit('agent:login', agentId);
        }
        
        this.addSystemMessage(`You are now logged in as ${this.agents[agentId]?.name || agentId}`);
    }
    
    logout() {
        if (this.currentAgent && this.socket) {
            this.socket.emit('agent:logout', this.currentAgent);
        }
        this.currentAgent = null;
        localStorage.removeItem('currentAgent');
        this.showLoginModal();
    }
    
    switchView(view) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(`${view}-view`).classList.remove('hidden');
        
        document.getElementById('page-title').textContent = 
            view === 'dashboard' ? 'Dashboard' :
            view === 'chat' ? 'Agent Chat' :
            view === 'agents' ? 'Agents' : 'Activity Log';
        
        this.currentView = view;
        
        if (view === 'chat') {
            this.unreadCount = 0;
            this.updateBadge();
            this.scrollToBottom();
        }
    }
    
    // Rendering
    renderAgents() {
        const grid = document.getElementById('agent-status-grid');
        const list = document.getElementById('agents-list');
        
        if (grid) {
            grid.innerHTML = Object.values(this.agents).map(agent => `
                <div class="agent-card ${agent.status}">
                    <div class="agent-avatar-lg" style="background: ${agent.color}20; border: 2px solid ${agent.color}">
                        ${agent.avatar}
                    </div>
                    <div class="agent-info">
                        <h4>${agent.name}</h4>
                        <span class="status">
                            <span class="agent-status-dot ${agent.status}"></span>
                            ${agent.status}
                        </span>
                    </div>
                </div>
            `).join('');
        }
        
        if (list) {
            list.innerHTML = Object.values(this.agents).map(agent => `
                <div class="agent-detail-card">
                    <div class="agent-detail-avatar" style="background: ${agent.color}20; border: 3px solid ${agent.color}">
                        ${agent.avatar}
                    </div>
                    <div class="agent-detail-info">
                        <div class="agent-detail-header">
                            <h3>${agent.name}</h3>
                            <span class="agent-status-badge ${agent.status}">${agent.status}</span>
                        </div>
                        <p style="color: var(--text-secondary);">
                            ${agent.currentTask || 'No active task'}
                        </p>
                        <div class="agent-meta">
                            <div class="agent-meta-item">
                                <div class="agent-meta-label">Status</div>
                                <div class="agent-meta-value" style="color: ${agent.color}">${agent.status}</div>
                            </div>
                            <div class="agent-meta-item">
                                <div class="agent-meta-label">Last Active</div>
                                <div class="agent-meta-value">${agent.lastActivity ? this.formatTime(agent.lastActivity) : 'Never'}</div>
                            </div>
                            <div class="agent-meta-item">
                                <div class="agent-meta-label">Agent ID</div>
                                <div class="agent-meta-value">${agent.id}</div>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }
    
    renderStats() {
        const online = Object.values(this.agents).filter(a => a.status === 'online').length;
        const busy = Object.values(this.agents).filter(a => a.currentTask).length;
        
        document.getElementById('stat-online').textContent = online;
        document.getElementById('stat-busy').textContent = busy;
        document.getElementById('stat-messages').textContent = this.messages.length;
        document.getElementById('stat-activities').textContent = this.activities.length;
    }
    
    renderActivity() {
        const lists = [document.getElementById('activity-list'), document.getElementById('full-activity-list')];
        
        lists.forEach(list => {
            if (list) {
                list.innerHTML = this.activities.slice(0, list.classList.contains('full') ? 100 : 10).map(a => this.createActivityHTML(a)).join('');
            }
        });
    }
    
    prependActivity(activity) {
        const lists = [document.getElementById('activity-list'), document.getElementById('full-activity-list')];
        
        lists.forEach(list => {
            if (list) {
                const div = document.createElement('div');
                div.innerHTML = this.createActivityHTML(activity);
                list.insertBefore(div.firstElementChild, list.firstChild);
                
                // Keep only last items
                while (list.children.length > (list.classList.contains('full') ? 100 : 10)) {
                    list.removeChild(list.lastChild);
                }
            }
        });
    }
    
    createActivityHTML(activity) {
        const agent = this.agents[activity.agentId];
        return `
            <div class="activity-item">
                <div class="activity-icon ${activity.type}">
                    <i class="fas fa-${this.getActivityIcon(activity.type)}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-text">
                        <strong style="color: ${agent?.color || 'inherit'}">${agent?.name || activity.agentId}</strong> ${activity.description}
                    </div>
                    <div class="activity-time">${this.formatTime(activity.timestamp)}</div>
                </div>
            </div>
        `;
    }
    
    getActivityIcon(type) {
        const icons = {
            login: 'sign-in-alt',
            logout: 'sign-out-alt',
            message: 'comment',
            task: 'tasks',
            command: 'terminal',
            disconnect: 'unlink'
        };
        return icons[type] || 'circle';
    }
    
    renderMessages() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.innerHTML = this.messages.map(m => this.createMessageHTML(m)).join('');
            this.scrollToBottom();
        }
    }
    
    appendMessage(message) {
        const container = document.getElementById('chat-messages');
        if (container) {
            const div = document.createElement('div');
            div.innerHTML = this.createMessageHTML(message);
            container.appendChild(div.firstElementChild);
            this.scrollToBottom();
        }
    }
    
    addSystemMessage(text) {
        const container = document.getElementById('chat-messages');
        if (container) {
            const div = document.createElement('div');
            div.className = 'message system';
            div.innerHTML = `
                <div class="message-content">
                    <span class="message-text">${text}</span>
                </div>
            `;
            container.appendChild(div);
            this.scrollToBottom();
        }
    }
    
    createMessageHTML(message) {
        const fromAgent = this.agents[message.fromAgentId];
        const isOwn = message.fromAgentId === this.currentAgent;
        
        return `
            <div class="message ${isOwn ? 'own' : ''}">
                <div class="message-avatar" style="background: ${fromAgent?.color || '#666'}20; border: 2px solid ${fromAgent?.color || '#666'}">
                    ${fromAgent?.avatar || '👤'}
                </div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author" style="color: ${fromAgent?.color || 'inherit'}">${fromAgent?.name || message.fromAgentId}</span>
                        <span class="message-time">${this.formatTime(message.timestamp)}</span>
                    </div>
                    <div class="message-text">${this.escapeHtml(message.content)}</div>
                </div>
            </div>
        `;
    }
    
    renderDMList() {
        const list = document.getElementById('dm-list');
        if (list) {
            list.innerHTML = Object.values(this.agents).map(agent => `
                <div class="dm-item" data-agent="${agent.id}">
                    <span class="dm-avatar">${agent.avatar}</span>
                    <span class="dm-name">${agent.name}</span>
                    <span class="dm-status ${agent.status}"></span>
                </div>
            `).join('');
        }
    }
    
    // Chat functionality
    sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content || !this.currentAgent) {
            if (!this.currentAgent) {
                alert('Please select an agent first');
            }
            return;
        }
        
        let toAgentId = null;
        
        // Check for @mentions
        const mentionMatch = content.match(/@(\w+)/);
        if (mentionMatch) {
            const mentionedAgent = Object.values(this.agents).find(a => 
                a.name.toLowerCase() === mentionMatch[1].toLowerCase()
            );
            if (mentionedAgent) {
                toAgentId = mentionedAgent.id;
            }
        }
        
        // Determine message type based on room
        let messageType = 'text';
        if (this.currentRoom === 'commands') messageType = 'command';
        if (content.startsWith('/')) messageType = 'command';
        
        this.socket.emit('chat:message', {
            fromAgentId: this.currentAgent,
            toAgentId,
            content,
            messageType
        });
        
        input.value = '';
        this.socket.emit('chat:typing', { agentId: this.currentAgent, isTyping: false });
    }
    
    handleTyping() {
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        
        if (this.currentAgent) {
            this.socket.emit('chat:typing', { agentId: this.currentAgent, isTyping: true });
            
            this.typingTimeout = setTimeout(() => {
                this.socket.emit('chat:typing', { agentId: this.currentAgent, isTyping: false });
            }, 2000);
        }
    }
    
    showTypingIndicator(agentId, isTyping) {
        const indicator = document.getElementById('typing-indicator');
        const agent = this.agents[agentId];
        
        if (isTyping && agent) {
            indicator.textContent = `${agent.name} is typing...`;
        } else {
            indicator.textContent = '';
        }
    }
    
    // Command handling
    handleIncomingCommand(command) {
        console.log('Received command:', command);
        this.addSystemMessage(`Command from ${this.agents[command.fromAgentId]?.name}: ${command.command}`);
    }
    
    sendCommand(toAgentId, command, params = {}) {
        if (!this.currentAgent) return;
        
        this.socket.emit('agent:command', {
            fromAgentId: this.currentAgent,
            toAgentId,
            command,
            params
        });
    }
    
    // Helpers
    updateConnectionStatus(connected) {
        const dot = document.getElementById('conn-status');
        const text = document.getElementById('conn-text');
        
        if (connected) {
            dot.classList.add('connected');
            text.textContent = 'Connected';
        } else {
            dot.classList.remove('connected');
            text.textContent = 'Disconnected';
        }
    }
    
    updateBadge() {
        const badge = document.getElementById('chat-badge');
        if (badge) {
            badge.textContent = this.unreadCount;
            badge.style.display = this.unreadCount > 0 ? 'block' : 'none';
        }
    }
    
    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
    
    wrapText(input, wrap) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const value = input.value;
        
        input.value = value.substring(0, start) + wrap + value.substring(start, end) + wrap + value.substring(end);
        input.focus();
        input.setSelectionRange(start + wrap.length, end + wrap.length);
    }
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        
        return date.toLocaleDateString();
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new AgentDashboard();
});