// OpenClaw Agent Dashboard - Frontend App with Pusher Real-time
// Ferry is the Owner with full agent control

class AgentDashboard {
    constructor() {
        this.apiUrl = '/api';
        this.currentAgent = null;
        this.currentView = 'dashboard';
        this.currentRoom = 'general';
        this.agents = {};
        this.messages = [];
        this.activities = [];
        this.unreadCount = 0;
        this.typingTimeout = null;
        this.lastMessageId = null;
        this.lastActivityId = null;
        
        // Ferry as Owner
        this.userId = 'ferry';
        this.userProfile = {
            id: 'ferry',
            name: 'Ferry',
            avatar: '👤',
            color: '#FFD700',
            role: 'owner',
            roleLabel: 'Owner',
            canManageAgents: true,
            canCallAgents: true
        };
        
        // Pusher for real-time
        this.pusher = null;
        this.channel = null;
        
        this.init();
    }
    
    async init() {
        this.bindEvents();
        await this.loadInitialData();
        this.initPusher();
        this.checkLoginStatus();
    }
    
    // Initialize Pusher for real-time updates
    initPusher() {
        // Get Pusher config from init data or use defaults
        const pusherKey = window.PUSHER_KEY || 'your-key';
        const pusherCluster = window.PUSHER_CLUSTER || 'ap1';
        
        if (typeof Pusher === 'undefined') {
            console.warn('Pusher not loaded, falling back to polling');
            this.startPolling();
            return;
        }
        
        this.pusher = new Pusher(pusherKey, {
            cluster: pusherCluster,
            encrypted: true
        });
        
        this.channel = this.pusher.subscribe('dashboard');
        
        // Bind to real-time events
        this.channel.bind('chat:message', (message) => {
            this.handleRealtimeMessage(message);
        });
        
        this.channel.bind('activity:new', (activity) => {
            this.handleRealtimeActivity(activity);
        });
        
        this.channel.bind('agent:updated', (agent) => {
            this.handleRealtimeAgentUpdate(agent);
        });
        
        this.channel.bind('chat:read', (messageId) => {
            this.handleRealtimeRead(messageId);
        });
        
        console.log('✅ Real-time connected via Pusher');
        this.updateConnectionStatus(true, 'realtime');
    }
    
    // Fallback polling (kept for compatibility)
    startPolling() {
        console.log('Starting polling fallback...');
        setInterval(() => this.pollForUpdates(), 2000);
        // Also poll Gateway health every 10 seconds
        setInterval(() => this.pollGatewayHealth(), 10000);
    }
    
    // Poll Gateway health status
    async pollGatewayHealth() {
        try {
            const health = await this.apiGet('/gateway/health');
            this.updateGatewayStatus(health.connected);
        } catch (error) {
            console.warn('Gateway health check failed:', error);
            this.updateGatewayStatus(false);
        }
    }
    
    async pollForUpdates() {
        try {
            // Only poll if not using real-time
            if (this.pusher && this.pusher.connection.state === 'connected') {
                return;
            }
            
            const agents = await this.apiGet('/agents');
            const agentsChanged = JSON.stringify(agents) !== JSON.stringify(Object.values(this.agents));
            if (agentsChanged) {
                this.agents = agents.reduce((acc, agent) => {
                    acc[agent.id] = agent;
                    return acc;
                }, {});
                this.renderAgents();
                this.renderStats();
                this.renderDMList();
            }
            
            const messages = await this.apiGet('/messages?limit=50');
            if (messages.length > this.messages.length) {
                const newMessages = messages.slice(this.messages.length);
                newMessages.forEach(msg => {
                    this.messages.push(msg);
                    this.appendMessage(msg);
                    if (msg.fromAgentId !== this.currentAgent) {
                        this.unreadCount++;
                    }
                });
                this.updateBadge();
            }
            
            const activities = await this.apiGet('/activities?limit=20');
            if (activities.length > 0 && activities[0].id !== this.lastActivityId) {
                this.activities = activities;
                this.renderActivity();
                this.lastActivityId = activities[0].id;
            }
            
            this.updateConnectionStatus(true, 'polling');
        } catch (error) {
            console.error('Polling error:', error);
            this.updateConnectionStatus(false);
        }
    }
    
    // Real-time event handlers
    handleRealtimeMessage(message) {
        // Check if message already exists
        if (this.messages.find(m => m.id === message.id)) {
            return;
        }
        
        this.messages.push(message);
        this.appendMessage(message);
        
        if (message.fromAgentId !== this.currentAgent && message.fromAgentId !== this.userId) {
            this.unreadCount++;
            this.updateBadge();
        }
        
        // Play notification sound if enabled
        this.playNotificationSound(message);
    }
    
    handleRealtimeActivity(activity) {
        // Check if activity already exists
        if (this.activities.find(a => a.id === activity.id)) {
            return;
        }
        
        this.activities.unshift(activity);
        if (this.activities.length > 100) {
            this.activities.pop();
        }
        
        this.prependActivity(activity);
        this.renderStats();
    }
    
    handleRealtimeAgentUpdate(agent) {
        this.agents[agent.id] = agent;
        this.renderAgents();
        this.renderStats();
        this.renderDMList();
    }
    
    handleRealtimeRead(messageId) {
        const msg = this.messages.find(m => m.id === messageId);
        if (msg) {
            msg.read = true;
        }
    }
    
    playNotificationSound(message) {
        // Optional: Add sound notification
        // const audio = new Audio('/notification.mp3');
        // audio.play().catch(() => {});
    }
    
    // API Helpers
    async apiGet(endpoint) {
        const response = await fetch(`${this.apiUrl}${endpoint}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
    
    async apiPost(endpoint, data) {
        const response = await fetch(`${this.apiUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
    
    async apiPut(endpoint, data) {
        const response = await fetch(`${this.apiUrl}${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
    
    async loadInitialData() {
        try {
            const data = await this.apiGet('/init');
            
            // Store Pusher config
            if (data.pusherKey) {
                window.PUSHER_KEY = data.pusherKey;
                window.PUSHER_CLUSTER = data.pusherCluster;
            }
            
            this.agents = data.agents.reduce((acc, agent) => {
                acc[agent.id] = agent;
                return acc;
            }, {});
            
            // Load users (Ferry, etc.)
            if (data.users) {
                this.users = data.users;
                if (data.users.ferry) {
                    this.userProfile = { ...this.userProfile, ...data.users.ferry };
                }
            }
            
            this.messages = data.messages;
            this.activities = data.activities;
            
            // Track last IDs
            if (this.messages.length > 0) {
                this.lastMessageId = this.messages[this.messages.length - 1].id;
            }
            if (this.activities.length > 0) {
                this.lastActivityId = activities[0].id;
            }
            
            // Check Gateway connection status
            if (data.gatewayConnected) {
                this.gatewayConnected = true;
                console.log('✅ OpenClaw Gateway connected');
            } else {
                this.gatewayConnected = false;
                console.warn('⚠️ OpenClaw Gateway not connected');
            }
            
            this.renderAgents();
            this.renderStats();
            this.renderActivity();
            this.renderMessages();
            this.renderDMList();
            this.updateConnectionStatus(true);
            this.updateGatewayStatus(data.gatewayConnected);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.updateConnectionStatus(false);
            this.updateGatewayStatus(false);
        }
    }
    
    // Update Gateway connection status in UI
    updateGatewayStatus(connected) {
        this.gatewayConnected = connected;
        
        // Update connection status text to include Gateway info
        const connText = document.getElementById('conn-text');
        if (connText) {
            if (connected) {
                connText.innerHTML = '⚡ Real-time · 🔗 Gateway';
                connText.style.color = '#4ade80';
            } else {
                connText.innerHTML = '⚡ Real-time · 🔴 Gateway Offline';
                connText.style.color = '#fbbf24';
            }
        }
        
        // Add Gateway status indicator if not exists
        const sidebarFooter = document.querySelector('.sidebar-footer');
        if (sidebarFooter) {
            let gatewayStatus = document.getElementById('gateway-status');
            if (!gatewayStatus) {
                gatewayStatus = document.createElement('div');
                gatewayStatus.id = 'gateway-status';
                gatewayStatus.className = 'gateway-status';
                gatewayStatus.style.cssText = 'margin-top: 8px; font-size: 0.75rem; padding: 4px 8px; border-radius: 4px;';
                sidebarFooter.insertBefore(gatewayStatus, sidebarFooter.firstChild);
            }
            
            if (connected) {
                gatewayStatus.innerHTML = '🟢 OpenClaw Gateway Connected';
                gatewayStatus.style.background = 'rgba(74, 222, 128, 0.1)';
                gatewayStatus.style.color = '#4ade80';
            } else {
                gatewayStatus.innerHTML = '🔴 Gateway Disconnected';
                gatewayStatus.style.background = 'rgba(248, 113, 113, 0.1)';
                gatewayStatus.style.color = '#f87171';
            }
        }
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
                else if (title === 'Call Agent') this.toggleAgentDropdown();
            });
        });
        
        // Agent command dropdown items
        document.querySelectorAll('.agent-cmd-item').forEach(item => {
            item.addEventListener('click', () => {
                const agentId = item.dataset.agent;
                const input = document.getElementById('message-input');
                input.value = `/${agentId} `;
                input.focus();
                this.hideAgentDropdown();
            });
        });
        
        // Owner Call Agent button
        document.getElementById('owner-call-btn')?.addEventListener('click', () => {
            this.toggleOwnerCallModal();
        });
        
        // Close owner call modal
        document.getElementById('close-owner-call')?.addEventListener('click', () => {
            this.hideOwnerCallModal();
        });
        
        // Owner call agent selection
        document.querySelectorAll('.owner-call-agent-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const agentId = btn.dataset.agent;
                document.getElementById('owner-call-target').value = agentId;
                document.getElementById('owner-call-input').focus();
            });
        });
        
        // Send owner call
        document.getElementById('send-owner-call')?.addEventListener('click', () => {
            this.sendOwnerCall();
        });
        
        document.getElementById('owner-call-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendOwnerCall();
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('agent-cmd-dropdown');
            const btn = document.getElementById('agent-cmd-btn');
            if (!dropdown?.contains(e.target) && !btn?.contains(e.target)) {
                this.hideAgentDropdown();
            }
        });
        
        // DM item click - open direct message
        document.getElementById('dm-list')?.addEventListener('click', (e) => {
            const dmItem = e.target.closest('.dm-item');
            if (dmItem) {
                const agentId = dmItem.dataset.agent;
                this.startDirectMessage(agentId);
            }
        });
    }
    
    // Owner Call Agent Feature - Ferry calls agents directly
    toggleOwnerCallModal() {
        const modal = document.getElementById('owner-call-modal');
        if (modal) {
            modal.classList.toggle('hidden');
            if (!modal.classList.contains('hidden')) {
                document.getElementById('owner-call-input')?.focus();
            }
        }
    }
    
    hideOwnerCallModal() {
        const modal = document.getElementById('owner-call-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
    
    async sendOwnerCall() {
        const agentId = document.getElementById('owner-call-target')?.value;
        const command = document.getElementById('owner-call-input')?.value?.trim();
        
        if (!agentId) {
            this.addSystemMessage('❌ Please select an agent to call');
            return;
        }
        if (!command) {
            this.addSystemMessage('❌ Please enter a command');
            return;
        }
        
        try {
            // Show calling message
            this.addSystemMessage(`📞 Calling ${this.agents[agentId]?.name || agentId}...`);
            
            const response = await this.apiPost('/owner/call-agent', {
                agentId: agentId,
                command: command,
                params: command,
                ownerId: this.userId
            });
            
            if (response.success) {
                document.getElementById('owner-call-input').value = '';
                this.hideOwnerCallModal();
                
                // Switch to chat view to see response
                this.switchView('chat');
            }
        } catch (error) {
            console.error('Owner call failed:', error);
            this.addSystemMessage(`❌ Failed to call agent: ${error.message}`);
        }
    }
    
    toggleAgentDropdown() {
        const dropdown = document.getElementById('agent-cmd-dropdown');
        if (dropdown) {
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        }
    }
    
    hideAgentDropdown() {
        const dropdown = document.getElementById('agent-cmd-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    }
    
    startDirectMessage(agentId) {
        const agent = this.agents[agentId];
        if (!agent) return;
        
        // Switch to chat view
        this.switchView('chat');
        
        // Update room name to show DM
        document.getElementById('chat-room-name').textContent = `@${agent.name}`;
        
        // Set current room as DM
        this.currentRoom = `dm-${agentId}`;
        
        // Focus input
        document.getElementById('message-input').focus();
        
        // Add system message
        this.addSystemMessage(`Starting direct message with ${agent.name}`);
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
        document.getElementById('login-modal')?.classList.remove('hidden');
    }
    
    closeLoginModal() {
        document.getElementById('login-modal')?.classList.add('hidden');
    }
    
    async loginAs(agentId) {
        this.currentAgent = agentId;
        localStorage.setItem('currentAgent', agentId);
        
        document.getElementById('current-agent').value = agentId;
        this.closeLoginModal();
        
        try {
            await this.apiPost(`/agents/${agentId}/login`);
            this.addSystemMessage(`You are now logged in as ${this.agents[agentId]?.name || agentId}`);
            this.renderAgents();
        } catch (error) {
            console.error('Login failed:', error);
        }
    }
    
    async logout() {
        if (this.currentAgent) {
            try {
                await this.apiPost(`/agents/${this.currentAgent}/logout`);
            } catch (error) {
                console.error('Logout failed:', error);
            }
        }
        this.currentAgent = null;
        localStorage.removeItem('currentAgent');
        this.showLoginModal();
    }
    
    switchView(view) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(`${view}-view`)?.classList.remove('hidden');
        
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
            // Add Ferry as Owner card first, then agents
            const ownerCard = `
                <div class="agent-card owner online">
                    <div class="agent-avatar-lg" style="background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); border: 2px solid #FFD700; box-shadow: 0 0 15px rgba(255, 215, 0, 0.3);">
                        👤👑
                    </div>
                    <div class="agent-info">
                        <h4>${this.userProfile.name} <span style="color: #FFD700; font-size: 0.75rem;">👑 OWNER</span></h4>
                        <span class="status">
                            <span class="agent-status-dot online"></span>
                            online
                        </span>
                    </div>
                </div>
            `;
            const agentCards = Object.values(this.agents).map(agent => `
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
            grid.innerHTML = ownerCard + agentCards;
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
                        ${this.userProfile.role === 'owner' ? `
                            <div class="agent-actions">
                                <button class="btn btn-primary btn-sm" onclick="window.dashboard.callAgentDirect('${agent.id}')">
                                    <i class="fas fa-phone"></i> Call Agent
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        }
    }
    
    // Direct call from agent card
    callAgentDirect(agentId) {
        document.getElementById('owner-call-target').value = agentId;
        this.toggleOwnerCallModal();
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
                
                while (list.children.length > (list.classList.contains('full') ? 100 : 10)) {
                    list.removeChild(list.lastChild);
                }
            }
        });
    }
    
    createActivityHTML(activity) {
        const agent = this.agents[activity.agentId] || this.users[activity.agentId];
        const isOwnerCall = activity.metadata?.commandType === 'owner-call';
        
        return `
            <div class="activity-item ${isOwnerCall ? 'owner-call' : ''}">
                <div class="activity-icon ${activity.type}">
                    <i class="fas fa-${this.getActivityIcon(activity.type)}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-text">
                        <strong style="color: ${agent?.color || 'inherit'}">${agent?.name || activity.agentId}</strong> 
                        ${isOwnerCall ? '<span class="owner-badge">📞 OWNER CALL</span>' : ''}
                        ${activity.description}
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
        // Handle owner calls specially
        if (message.messageType === 'owner-call') {
            return this.createOwnerCallMessageHTML(message);
        }
        if (message.messageType === 'agent-response') {
            return this.createAgentResponseMessageHTML(message);
        }
        
        // Handle messages from owner (Ferry)
        if (message.fromAgentId === this.userId || message.fromAgentId === 'ferry') {
            const isOwn = true;
            return `
                <div class="message ${isOwn ? 'own' : ''} user-message owner-message">
                    <div class="message-avatar" style="background: ${this.userProfile.color}20; border: 2px solid ${this.userProfile.color}">
                        ${this.userProfile.avatar}
                        <span class="role-badge">${this.userProfile.roleLabel}</span>
                    </div>
                    <div class="message-content">
                        <div class="message-header">
                            <span class="message-author" style="color: ${this.userProfile.color}">
                                ${this.userProfile.name}
                                <span class="owner-tag">👑 Owner</span>
                            </span>
                            <span class="message-time">${this.formatTime(message.timestamp)}</span>
                        </div>
                        <div class="message-text">${this.escapeHtml(message.content)}</div>
                    </div>
                </div>
            `;
        }
        
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
    
    createOwnerCallMessageHTML(message) {
        return `
            <div class="message owner-call-message">
                <div class="message-avatar" style="background: ${this.userProfile.color}20; border: 2px solid ${this.userProfile.color}">
                    📞
                </div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author" style="color: ${this.userProfile.color}">
                            ${this.userProfile.name} 
                            <span class="call-badge">📞 CALLED AGENT</span>
                        </span>
                        <span class="message-time">${this.formatTime(message.timestamp)}</span>
                    </div>
                    <div class="message-text call-text">${this.escapeHtml(message.content)}</div>
                </div>
            </div>
        `;
    }
    
    createAgentResponseMessageHTML(message) {
        const fromAgent = this.agents[message.fromAgentId];
        return `
            <div class="message agent-response-message">
                <div class="message-avatar" style="background: ${fromAgent?.color || '#666'}20; border: 2px solid ${fromAgent?.color || '#666'}">
                    ${fromAgent?.avatar || '👤'}
                    <span class="response-badge">📞</span>
                </div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author" style="color: ${fromAgent?.color || 'inherit'}">
                            ${fromAgent?.name || message.fromAgentId}
                            <span class="response-tag">Response to Owner</span>
                        </span>
                        <span class="message-time">${this.formatTime(message.timestamp)}</span>
                    </div>
                    <div class="message-text response-text">${this.escapeHtml(message.content)}</div>
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
                    <button class="dm-btn" onclick="window.dashboard.startDirectMessage('${agent.id}'); event.stopPropagation();">
                        <i class="fas fa-comment"></i>
                    </button>
                </div>
            `).join('');
        }
    }
    
    // Chat functionality
    async sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content) {
            return;
        }
        
        // Check if this is an agent command (e.g., /jarvis hello)
        const agentCommandMatch = content.match(/^\/(\w+)\s*(.*)$/);
        if (agentCommandMatch) {
            const agentName = agentCommandMatch[1].toLowerCase();
            const command = agentCommandMatch[2] || 'hello';
            
            // Find the agent by ID
            const targetAgent = this.agents[agentName];
            if (targetAgent) {
                await this.sendAgentCommand(agentName, command);
                input.value = '';
                return;
            } else {
                this.addSystemMessage(`Agent '${agentName}' not found. Available: jarvis, friday, glass, epstein, yuri`);
                return;
            }
        }
        
        // Regular message - require current agent selection
        if (!this.currentAgent) {
            alert('Please select an agent first or use /agentname to call an agent directly');
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
        
        try {
            const message = await this.apiPost('/messages', {
                fromAgentId: this.currentAgent,
                toAgentId,
                content,
                messageType
            });
            
            this.messages.push(message);
            this.appendMessage(message);
            input.value = '';
        } catch (error) {
            console.error('Failed to send message:', error);
            this.addSystemMessage('Failed to send message');
        }
    }
    
    // Send command to invoke an agent directly (as Ferry/user)
    async sendAgentCommand(agentId, command) {
        try {
            // Show "calling" message
            this.addSystemMessage(`Calling ${this.agents[agentId]?.name || agentId}...`);
            
            const response = await this.apiPost('/agent-command', {
                agentId: agentId,
                command: command,
                params: command,
                userId: this.userId
            });
            
            if (response.success) {
                console.log(`Command sent to ${agentId}:`, response);
            }
        } catch (error) {
            console.error('Failed to send agent command:', error);
            this.addSystemMessage(`Failed to call agent: ${error.message}`);
        }
    }
    
    // Send direct message to specific agent (as Ferry/user)
    async sendDirectMessage(agentId, content) {
        if (!content.trim()) return;
        
        try {
            const message = await this.apiPost('/messages', {
                fromAgentId: this.userId,
                toAgentId: agentId,
                content,
                messageType: 'direct'
            });
            
            this.messages            this.messages.push(message);
            this.appendMessage(message);
        } catch (error) {
            console.error('Failed to send DM:', error);
            this.addSystemMessage('Failed to send direct message');
        }
    }
    
    handleTyping() {
        // Typing indicator not supported in REST API mode
        // Could be implemented with a separate endpoint if needed
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
    
    async sendCommand(toAgentId, command, params = {}) {
        if (!this.currentAgent) return;
        
        try {
            await this.apiPost('/activities', {
                agentId: this.currentAgent,
                type: 'command',
                description: `Executed command: ${command}`,
                metadata: { toAgentId, params }
            });
        } catch (error) {
            console.error('Failed to send command:', error);
        }
    }
    
    // Helpers
    updateConnectionStatus(connected, type = 'polling') {
        const dot = document.getElementById('conn-status');
        const text = document.getElementById('conn-text');
        
        if (connected) {
            dot.classList.add('connected');
            if (type === 'realtime') {
                dot.classList.add('realtime');
                text.textContent = '⚡ Real-time';
            } else {
                text.textContent = 'Connected';
            }
        } else {
            dot.classList.remove('connected', 'realtime');
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
