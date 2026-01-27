# Security Guide for Self-Hosters

**FreshGuard Core - Secure Data Pipeline Monitoring for Self-Hosters**

This guide provides comprehensive security guidance for self-hosting FreshGuard Core in production environments. Following these guidelines will help you deploy a secure, reliable data monitoring system.

## Table of Contents

- [Security Overview](#security-overview)
- [Threat Model](#threat-model)
- [Pre-Deployment Security Checklist](#pre-deployment-security-checklist)
- [Database Security](#database-security)
- [Network Security](#network-security)
- [Application Security](#application-security)
- [Credential Management](#credential-management)
- [Monitoring and Logging](#monitoring-and-logging)
- [Incident Response](#incident-response)
- [Compliance Guidelines](#compliance-guidelines)
- [Security Maintenance](#security-maintenance)
- [Troubleshooting Security Issues](#troubleshooting-security-issues)

## Security Overview

FreshGuard Core implements a **security-agnostic** design philosophy, meaning:

- **Core library provides security building blocks** - SQL injection prevention, input validation, error sanitization
- **Deployers are responsible for operational security** - Network isolation, credential management, infrastructure hardening
- **Defense in depth** - Multiple layers of security controls
- **Principle of least privilege** - Minimal required permissions
- **Fail-secure defaults** - Secure by default configuration

### Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Network Security Layer                   │
├─────────────────────────────────────────────────────────────┤
│                  Infrastructure Security                    │
├─────────────────────────────────────────────────────────────┤
│                   Application Security                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              FreshGuard Core                        │    │
│  │  • Input validation        • Error sanitization    │    │
│  │  • SQL injection prevention • Timeout protection   │    │
│  │  • Secure connectors       • Audit logging         │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                    Database Security                        │
└─────────────────────────────────────────────────────────────┘
```

## Threat Model

### Protected Against

✅ **SQL Injection Attacks**
- Parameterized queries with identifier validation
- Blocked dangerous SQL keywords and patterns
- Input sanitization and length limits

✅ **Command Injection**
- Input validation for CLI commands
- Safe file path handling
- Environment variable validation

✅ **Information Disclosure**
- Error message sanitization
- Credential masking in logs
- Debug information only in development mode

✅ **Denial of Service (DoS)**
- Connection and query timeouts
- Result set size limits
- Rate limiting capabilities

✅ **Path Traversal**
- Configuration file path validation
- Database file path restrictions (DuckDB)
- Safe directory access controls

✅ **Credential Exposure**
- Environment-based credential storage
- No credentials in process arguments or logs
- Secure connection string parsing

### Requires Additional Protection

⚠️ **Network Security** - Implement firewalls and network segmentation
⚠️ **Infrastructure Security** - Harden operating system and containers
⚠️ **Identity and Access Management** - Implement proper authentication
⚠️ **Physical Security** - Secure physical access to servers
⚠️ **Backup Security** - Encrypt backups and secure storage

## Pre-Deployment Security Checklist

### Infrastructure Security

- [ ] **Operating System Hardening**
  - [ ] Apply latest security patches
  - [ ] Disable unnecessary services
  - [ ] Configure secure SSH access
  - [ ] Enable automatic security updates
  - [ ] Set up fail2ban or similar intrusion detection

- [ ] **Network Security**
  - [ ] Configure firewalls (iptables/ufw)
  - [ ] Implement network segmentation
  - [ ] Use private networks for database connections
  - [ ] Set up VPN for administrative access
  - [ ] Configure DNS securely

- [ ] **Container Security** (if using Docker)
  - [ ] Use official, minimal base images
  - [ ] Scan images for vulnerabilities
  - [ ] Run containers as non-root user
  - [ ] Use Docker secrets for credentials
  - [ ] Enable Docker Content Trust

### Application Security

- [ ] **FreshGuard Configuration**
  - [ ] Copy `.env.example` to `.env`
  - [ ] Set `NODE_ENV=production`
  - [ ] Set `FRESHGUARD_SECURITY_MODE=strict`
  - [ ] Configure appropriate timeouts
  - [ ] Enable SSL/TLS for all connections

- [ ] **Credential Security**
  - [ ] Generate strong, unique passwords
  - [ ] Use environment variables for credentials
  - [ ] Never commit credentials to version control
  - [ ] Implement credential rotation procedures

### Database Security

- [ ] **Database Hardening**
  - [ ] Create dedicated FreshGuard database user
  - [ ] Grant minimum required permissions
  - [ ] Enable SSL/TLS connections
  - [ ] Configure connection limits
  - [ ] Enable database audit logging

## Database Security

### PostgreSQL Security

#### Secure User Setup

```sql
-- Create dedicated user with minimal privileges
CREATE USER freshguard_monitor WITH PASSWORD 'STRONG_RANDOM_PASSWORD';

-- Grant only required permissions
GRANT CONNECT ON DATABASE your_database TO freshguard_monitor;
GRANT USAGE ON SCHEMA public TO freshguard_monitor;

-- For monitoring existing tables (read-only)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO freshguard_monitor;

-- For FreshGuard's own tables (if storing check results)
GRANT CREATE ON SCHEMA public TO freshguard_monitor;
```

#### SSL/TLS Configuration

```bash
# In postgresql.conf
ssl = on
ssl_cert_file = '/path/to/server.crt'
ssl_key_file = '/path/to/server.key'
ssl_ca_file = '/path/to/ca.crt'

# Require SSL connections
ssl_prefer_server_ciphers = on
ssl_ciphers = 'HIGH:MEDIUM:+3DES:!aNULL'

# In pg_hba.conf - require SSL
hostssl  freshguard_db  freshguard_monitor  0.0.0.0/0  md5
```

#### Connection String Security

```bash
# Secure PostgreSQL connection
export FRESHGUARD_DATABASE_URL="postgresql://freshguard_monitor:password@localhost:5432/freshguard_db?sslmode=require&sslcert=/path/to/client.crt&sslkey=/path/to/client.key&sslrootcert=/path/to/ca.crt"
```

### DuckDB Security

#### File System Permissions

```bash
# Create secure database directory
sudo mkdir -p /var/lib/freshguard/data
sudo chown freshguard:freshguard /var/lib/freshguard/data
sudo chmod 750 /var/lib/freshguard/data

# Set secure file permissions
sudo chmod 640 /var/lib/freshguard/data/*.duckdb
```

#### Secure Configuration

```bash
# Use absolute paths to prevent path traversal
export FRESHGUARD_DATABASE_URL="duckdb:///var/lib/freshguard/data/analytics.duckdb"

# Alternative: Use in-memory for temporary workloads
export FRESHGUARD_DATABASE_URL="duckdb://:memory:"
```

### BigQuery Security

#### Service Account Setup

```bash
# Create service account with minimal permissions
gcloud iam service-accounts create freshguard-monitor \
  --display-name="FreshGuard Monitor" \
  --description="Service account for FreshGuard data monitoring"

# Grant only required permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:freshguard-monitor@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:freshguard-monitor@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

# Create and download key
gcloud iam service-accounts keys create freshguard-sa.json \
  --iam-account=freshguard-monitor@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

#### Secure Key Storage

```bash
# Store service account key securely
sudo mkdir -p /etc/freshguard/credentials
sudo mv freshguard-sa.json /etc/freshguard/credentials/
sudo chmod 600 /etc/freshguard/credentials/freshguard-sa.json
sudo chown freshguard:freshguard /etc/freshguard/credentials/freshguard-sa.json

# Reference in environment
export BIGQUERY_SERVICE_ACCOUNT_PATH="/etc/freshguard/credentials/freshguard-sa.json"
```

### Snowflake Security

#### Secure Connection Setup

```sql
-- Create dedicated role and user
CREATE ROLE freshguard_monitor_role;
GRANT USAGE ON WAREHOUSE your_warehouse TO ROLE freshguard_monitor_role;
GRANT USAGE ON DATABASE your_database TO ROLE freshguard_monitor_role;
GRANT USAGE ON SCHEMA your_database.public TO ROLE freshguard_monitor_role;

-- Grant minimal select permissions
GRANT SELECT ON ALL TABLES IN SCHEMA your_database.public TO ROLE freshguard_monitor_role;

-- Create user
CREATE USER freshguard_monitor
  PASSWORD = 'STRONG_RANDOM_PASSWORD'
  DEFAULT_ROLE = freshguard_monitor_role
  MUST_CHANGE_PASSWORD = FALSE;

GRANT ROLE freshguard_monitor_role TO USER freshguard_monitor;
```

#### Network Security

```sql
-- Create network policy to restrict access
CREATE NETWORK POLICY freshguard_policy
  ALLOWED_IP_LIST = ('YOUR.FRESHGUARD.SERVER.IP/32');

-- Apply to user
ALTER USER freshguard_monitor SET NETWORK_POLICY = freshguard_policy;
```

## Network Security

### Firewall Configuration

#### iptables Example

```bash
#!/bin/bash
# FreshGuard firewall rules

# Drop all traffic by default
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow SSH (change port as needed)
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables -A OUTPUT -p tcp --sport 22 -j ACCEPT

# Allow outbound HTTPS (for external APIs)
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

# Allow database connections (adjust as needed)
iptables -A OUTPUT -p tcp --dport 5432 -j ACCEPT  # PostgreSQL
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT   # BigQuery/Snowflake

# Save rules
iptables-save > /etc/iptables/rules.v4
```

#### ufw Example (Ubuntu)

```bash
# Enable firewall
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default deny outgoing

# Allow SSH
sudo ufw allow 22/tcp

# Allow outbound HTTPS
sudo ufw allow out 443/tcp

# Allow database connections
sudo ufw allow out 5432/tcp  # PostgreSQL

# Enable firewall
sudo ufw --force enable
```

### Network Segmentation

#### Docker Network Example

```yaml
# docker-compose.yml
version: '3.8'
services:
  freshguard:
    build: .
    networks:
      - freshguard-internal
    environment:
      - FRESHGUARD_DATABASE_URL=postgresql://user:pass@postgres:5432/freshguard
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    networks:
      - freshguard-internal
    environment:
      POSTGRES_DB: freshguard
      POSTGRES_USER: freshguard_user
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password
    volumes:
      - postgres_data:/var/lib/postgresql/data

networks:
  freshguard-internal:
    driver: bridge
    internal: true  # No external internet access

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt

volumes:
  postgres_data:
```

### VPN Access

#### WireGuard Configuration

```ini
# /etc/wireguard/freshguard.conf
[Interface]
PrivateKey = <PRIVATE_KEY>
Address = 10.0.100.1/24
ListenPort = 51820

# Allow access to FreshGuard server
[Peer]
PublicKey = <CLIENT_PUBLIC_KEY>
AllowedIPs = 10.0.100.2/32
```

## Application Security

### Secure Configuration

#### Production Environment File

```bash
# /etc/freshguard/.env
NODE_ENV="production"
FRESHGUARD_SECURITY_MODE="strict"
FRESHGUARD_LOG_LEVEL="warn"

# Database connection
FRESHGUARD_DATABASE_URL="postgresql://freshguard_monitor:${DB_PASSWORD}@localhost:5432/freshguard_db?sslmode=require"

# Security timeouts
FRESHGUARD_CONNECTION_TIMEOUT="30000"
FRESHGUARD_QUERY_TIMEOUT="10000"
FRESHGUARD_MAX_ROWS="1000"

# SSL enforcement
FRESHGUARD_REQUIRE_SSL="true"

# Rate limiting
FRESHGUARD_RATE_LIMIT="100"
FRESHGUARD_SESSION_TIMEOUT="30"

# Auditing
FRESHGUARD_AUDIT_LOG="true"
FRESHGUARD_AUDIT_RETENTION="90"
```

### Systemd Service Security

```ini
# /etc/systemd/system/freshguard.service
[Unit]
Description=FreshGuard Data Monitoring
After=network.target
Requires=network.target

[Service]
Type=simple
User=freshguard
Group=freshguard
WorkingDirectory=/opt/freshguard
Environment=NODE_ENV=production
EnvironmentFile=/etc/freshguard/.env
ExecStart=/usr/local/bin/freshguard run
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/log/freshguard /var/lib/freshguard
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictSUIDSGID=true
RemoveIPC=true
PrivateUsers=true

[Install]
WantedBy=multi-user.target
```

### Log Security

#### Secure Log Configuration

```bash
# Create log directory with proper permissions
sudo mkdir -p /var/log/freshguard
sudo chown freshguard:freshguard /var/log/freshguard
sudo chmod 750 /var/log/freshguard

# Configure logrotate
cat > /etc/logrotate.d/freshguard << EOF
/var/log/freshguard/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 640 freshguard freshguard
    postrotate
        systemctl reload freshguard || true
    endscript
}
EOF
```

#### rsyslog Configuration

```bash
# /etc/rsyslog.d/freshguard.conf
# Send FreshGuard logs to separate files
if $programname == "freshguard" then {
    action(type="omfile" file="/var/log/freshguard/freshguard.log")
    stop
}

# Security events to separate file
if $msg contains "SECURITY" then {
    action(type="omfile" file="/var/log/freshguard/security.log")
    stop
}
```

## Credential Management

### Environment Variable Security

```bash
# Create secure environment file
sudo mkdir -p /etc/freshguard
sudo touch /etc/freshguard/.env
sudo chmod 600 /etc/freshguard/.env
sudo chown freshguard:freshguard /etc/freshguard/.env

# Generate strong passwords
openssl rand -base64 32 > /tmp/freshguard_password
sudo mv /tmp/freshguard_password /etc/freshguard/db_password
sudo chmod 600 /etc/freshguard/db_password
sudo chown freshguard:freshguard /etc/freshguard/db_password
```

### Secret Management Systems

#### HashiCorp Vault Integration

```bash
# Install Vault agent
sudo apt install vault

# Configure Vault agent
cat > /etc/vault/freshguard-config.hcl << EOF
vault {
  address = "https://vault.company.com:8200"
}

auto_auth {
  method {
    type = "aws"
    config = {
      type = "iam"
      role = "freshguard-role"
    }
  }
  sink {
    type = "file"
    config = {
      path = "/etc/freshguard/vault-token"
    }
  }
}

template {
  source      = "/etc/vault/freshguard.env.tpl"
  destination = "/etc/freshguard/.env"
  perms       = 0600
  command     = "systemctl reload freshguard"
}
EOF

# Template for environment file
cat > /etc/vault/freshguard.env.tpl << EOF
FRESHGUARD_DATABASE_URL="postgresql://freshguard_monitor:{{ with secret "secret/freshguard/db" }}{{ .Data.password }}{{ end }}@localhost:5432/freshguard_db?sslmode=require"
FRESHGUARD_API_KEY="{{ with secret "secret/freshguard/api" }}{{ .Data.key }}{{ end }}"
EOF
```

#### Kubernetes Secrets

```yaml
# Create secret
apiVersion: v1
kind: Secret
metadata:
  name: freshguard-secrets
type: Opaque
data:
  database-password: <base64-encoded-password>
  api-key: <base64-encoded-api-key>

---
# Use in deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: freshguard
spec:
  template:
    spec:
      containers:
      - name: freshguard
        env:
        - name: FRESHGUARD_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: freshguard-secrets
              key: database-password
        - name: FRESHGUARD_API_KEY
          valueFrom:
            secretKeyRef:
              name: freshguard-secrets
              key: api-key
```

### Credential Rotation

#### Automated Database Password Rotation

```bash
#!/bin/bash
# /usr/local/bin/rotate-freshguard-password.sh

set -euo pipefail

# Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# Update database
sudo -u postgres psql -c "ALTER USER freshguard_monitor PASSWORD '$NEW_PASSWORD';"

# Update environment file
sudo sed -i "s/FRESHGUARD_DB_PASSWORD=.*/FRESHGUARD_DB_PASSWORD=$NEW_PASSWORD/" /etc/freshguard/.env

# Restart service
sudo systemctl restart freshguard

# Log rotation
logger -t freshguard "Database password rotated successfully"

# Cleanup
unset NEW_PASSWORD
```

#### Cron Job for Regular Rotation

```bash
# /etc/cron.d/freshguard-rotation
# Rotate FreshGuard credentials monthly
0 2 1 * * freshguard /usr/local/bin/rotate-freshguard-password.sh
```

## Monitoring and Logging

### Security Monitoring

#### Log Analysis with fail2ban

```ini
# /etc/fail2ban/jail.d/freshguard.conf
[freshguard-auth]
enabled = true
filter = freshguard-auth
logpath = /var/log/freshguard/security.log
maxretry = 3
bantime = 3600
findtime = 600

[freshguard-sql-injection]
enabled = true
filter = freshguard-sql-injection
logpath = /var/log/freshguard/freshguard.log
maxretry = 1
bantime = 86400
findtime = 3600
```

#### fail2ban Filters

```bash
# /etc/fail2ban/filter.d/freshguard-auth.conf
[Definition]
failregex = ^.*\[ERROR\].*Authentication failed for user.*from <HOST>.*$
ignoreregex =

# /etc/fail2ban/filter.d/freshguard-sql-injection.conf
[Definition]
failregex = ^.*\[SECURITY\].*SQL injection attempt from <HOST>.*$
ignoreregex =
```

### Security Metrics

#### Prometheus Monitoring

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'freshguard'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 30s

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']
```

#### Grafana Security Dashboard

```json
{
  "dashboard": {
    "title": "FreshGuard Security Metrics",
    "panels": [
      {
        "title": "Failed Authentication Attempts",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(freshguard_auth_failures_total[5m])"
          }
        ]
      },
      {
        "title": "SQL Injection Attempts",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(freshguard_security_violations_total[5m])"
          }
        ]
      },
      {
        "title": "Connection Timeouts",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(freshguard_connection_timeouts_total[5m])"
          }
        ]
      }
    ]
  }
}
```

### Audit Logging

#### Structured Audit Logs

```javascript
// Example audit log entry
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "AUDIT",
  "event": "database_query",
  "user": "freshguard_monitor",
  "source_ip": "10.0.1.100",
  "database": "production_db",
  "table": "user_events",
  "action": "count_rows",
  "duration_ms": 150,
  "success": true,
  "rule_id": "freshness_check_001"
}
```

#### Log Shipping to SIEM

```bash
# Filebeat configuration for log shipping
cat > /etc/filebeat/conf.d/freshguard.yml << EOF
filebeat.inputs:
- type: log
  enabled: true
  paths:
    - /var/log/freshguard/*.log
  fields:
    service: freshguard
    environment: production
  fields_under_root: true
  multiline.pattern: '^\d{4}-\d{2}-\d{2}'
  multiline.negate: true
  multiline.match: after

output.elasticsearch:
  hosts: ["elasticsearch.company.com:9200"]
  username: "freshguard_shipper"
  password: "${ELASTICSEARCH_PASSWORD}"
  ssl.certificate_authorities: ["/etc/pki/tls/certs/ca.crt"]

processors:
  - add_host_metadata: ~
  - add_docker_metadata: ~
EOF
```

## Incident Response

### Security Incident Playbook

#### 1. Detection and Analysis

```bash
#!/bin/bash
# /usr/local/bin/freshguard-incident-response.sh

# Immediate containment
echo "INCIDENT DETECTED: $(date)"
echo "Stopping FreshGuard service..."
systemctl stop freshguard

# Collect evidence
echo "Collecting logs..."
mkdir -p /var/incident/freshguard-$(date +%Y%m%d-%H%M%S)
cp -r /var/log/freshguard/ /var/incident/freshguard-$(date +%Y%m%d-%H%M%S)/logs/
cp /etc/freshguard/.env /var/incident/freshguard-$(date +%Y%m%d-%H%M%S)/config/

# Network analysis
echo "Capturing network connections..."
ss -tulpn > /var/incident/freshguard-$(date +%Y%m%d-%H%M%S)/network_connections.txt

# Process analysis
echo "Capturing process information..."
ps auxf > /var/incident/freshguard-$(date +%Y%m%d-%H%M%S)/processes.txt

# File integrity check
echo "Running file integrity check..."
find /opt/freshguard -type f -exec sha256sum {} \; > /var/incident/freshguard-$(date +%Y%m%d-%H%M%S)/file_hashes.txt

# Database connection check
echo "Checking database connections..."
sudo -u postgres psql -c "\conninfo" > /var/incident/freshguard-$(date +%Y%m%d-%H%M%S)/db_status.txt

echo "Evidence collection complete. Review /var/incident/ before taking further action."
```

#### 2. Containment Steps

```bash
# Isolate the system
iptables -A INPUT -j DROP
iptables -A OUTPUT -j DROP

# Preserve evidence
mount -o remount,ro /var/log/freshguard/

# Rotate credentials immediately
/usr/local/bin/rotate-freshguard-password.sh

# Notify stakeholders
echo "SECURITY INCIDENT: FreshGuard system isolated" | mail -s "URGENT: Security Incident" security-team@company.com
```

#### 3. Eradication and Recovery

```bash
#!/bin/bash
# System recovery procedure

# Update system
apt update && apt upgrade -y

# Reinstall FreshGuard from known-good source
cd /opt/freshguard
git fetch origin
git reset --hard origin/main

# Verify checksums
sha256sum -c freshguard.sha256

# Update dependencies
pnpm install --prod --frozen-lockfile

# Review and update configuration
nano /etc/freshguard/.env

# Test in isolated environment
systemctl start freshguard
freshguard test

# Monitor for 24 hours before full restoration
systemctl enable freshguard
```

### Security Contacts

```bash
# /etc/freshguard/contacts.txt
Security Team: security@company.com
Database Admin: dba@company.com
Infrastructure: infra@company.com
Incident Response: incident@company.com

# Emergency contacts
On-call Security: +1-555-SECURITY
Infrastructure Lead: +1-555-INFRA-LEAD
```

## Compliance Guidelines

### GDPR Compliance

#### Data Retention Policy

```bash
#!/bin/bash
# GDPR data retention script

# Delete monitoring data older than specified retention period
RETENTION_DAYS=365

sudo -u postgres psql -d freshguard_db << EOF
-- Delete old monitoring results
DELETE FROM check_executions
WHERE executed_at < NOW() - INTERVAL '$RETENTION_DAYS days';

-- Delete old audit logs
DELETE FROM audit_log
WHERE created_at < NOW() - INTERVAL '$RETENTION_DAYS days';

-- Vacuum to reclaim space
VACUUM ANALYZE;
EOF

# Archive logs before deletion
find /var/log/freshguard -name "*.log" -mtime +$RETENTION_DAYS -exec gzip {} \;
find /var/log/freshguard -name "*.gz" -mtime +$((RETENTION_DAYS * 2)) -delete
```

#### Data Processing Record

```markdown
## FreshGuard Data Processing Record

**Controller**: [Your Organization]
**Data Protection Officer**: [DPO Contact]
**Last Updated**: [Date]

### Personal Data Processed
- Database connection logs (may contain usernames)
- Audit logs (may contain IP addresses)
- Error logs (may contain database identifiers)

### Legal Basis
- Legitimate interest in system monitoring and security

### Data Subjects
- Database administrators
- System administrators
- End users of monitored systems

### Retention Period
- Monitoring data: 365 days
- Audit logs: 90 days
- Error logs: 30 days

### Security Measures
- Encryption at rest and in transit
- Access controls and authentication
- Regular security assessments
- Incident response procedures
```

### SOC 2 Compliance

#### Access Controls

```bash
#!/bin/bash
# SOC 2 access control audit script

echo "FreshGuard Access Control Audit - $(date)"
echo "============================================"

# Check file permissions
echo "File permissions:"
find /opt/freshguard -type f -exec ls -la {} \; | grep -v '\-rw-------\|\-rw-r-----'

# Check service user
echo "Service user configuration:"
id freshguard

# Check sudo privileges
echo "Sudo privileges:"
sudo -l -U freshguard

# Check database access
echo "Database user privileges:"
sudo -u postgres psql -c "\du freshguard_monitor"

# Check network access
echo "Network connections:"
ss -tulpn | grep freshguard

echo "Audit complete."
```

#### Configuration Management

```yaml
# ansible playbook for SOC 2 compliance
---
- name: FreshGuard SOC 2 Compliance
  hosts: freshguard_servers
  become: yes
  tasks:
    - name: Ensure FreshGuard user exists
      user:
        name: freshguard
        system: yes
        shell: /bin/false
        home: /opt/freshguard
        create_home: no

    - name: Set file permissions
      file:
        path: "{{ item.path }}"
        mode: "{{ item.mode }}"
        owner: "{{ item.owner }}"
        group: "{{ item.group }}"
      loop:
        - { path: "/opt/freshguard", mode: "0750", owner: "freshguard", group: "freshguard" }
        - { path: "/etc/freshguard", mode: "0700", owner: "freshguard", group: "freshguard" }
        - { path: "/var/log/freshguard", mode: "0750", owner: "freshguard", group: "freshguard" }

    - name: Configure audit logging
      lineinfile:
        path: /etc/audit/rules.d/freshguard.rules
        line: "{{ item }}"
        create: yes
      loop:
        - "-w /opt/freshguard -p wa -k freshguard-files"
        - "-w /etc/freshguard -p wa -k freshguard-config"
        - "-w /var/log/freshguard -p wa -k freshguard-logs"
```

### PCI DSS (if applicable)

#### Network Segmentation

```bash
# PCI DSS network segmentation
iptables -A INPUT -s 192.168.100.0/24 -j DROP  # Block cardholder data network
iptables -A OUTPUT -d 192.168.100.0/24 -j DROP

# Allow only necessary database connections
iptables -A OUTPUT -d DATABASE_SERVER_IP -p tcp --dport 5432 -j ACCEPT
```

#### Encryption Requirements

```bash
# Verify SSL/TLS configuration
openssl s_client -connect database-server:5432 -starttls postgres

# Check certificate validity
openssl x509 -in /etc/ssl/certs/freshguard.crt -text -noout

# Verify encryption at rest
sudo cryptsetup status /dev/mapper/freshguard-data
```

## Security Maintenance

### Regular Security Tasks

#### Weekly Tasks

```bash
#!/bin/bash
# /usr/local/bin/freshguard-weekly-security.sh

# Update system packages
apt update && apt list --upgradable

# Check for CVEs in dependencies
pnpm audit

# Review authentication logs
journalctl -u freshguard --since "1 week ago" | grep -i auth

# Check file integrity
find /opt/freshguard -type f -exec sha256sum {} \; | diff - /var/lib/freshguard/checksums.txt

# Test backup restoration
/usr/local/bin/test-backup-restore.sh

# Generate weekly security report
/usr/local/bin/generate-security-report.sh
```

#### Monthly Tasks

```bash
#!/bin/bash
# /usr/local/bin/freshguard-monthly-security.sh

# Rotate credentials
/usr/local/bin/rotate-freshguard-password.sh

# Review access logs
grep -i "failed\|error\|denied" /var/log/freshguard/*.log | sort | uniq -c

# Update security baseline
/usr/local/bin/update-security-baseline.sh

# Penetration testing
nmap -sS -O localhost
nikto -h localhost

# Security configuration review
/usr/local/bin/review-security-config.sh
```

#### Quarterly Tasks

- Full security assessment by external auditor
- Vulnerability scanning with tools like OpenVAS
- Review and update incident response procedures
- Security awareness training for team members
- Review and update security documentation
- Disaster recovery testing

### Vulnerability Management

#### CVE Monitoring

```bash
#!/bin/bash
# CVE monitoring script

# Check Node.js vulnerabilities
pnpm audit --audit-level high

# Check system package vulnerabilities
apt list --upgradable | grep -i security

# Check Docker image vulnerabilities (if using containers)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image freshguard:latest

# Generate vulnerability report
{
  echo "FreshGuard Vulnerability Report - $(date)"
  echo "=========================================="
  echo ""
  echo "Node.js Dependencies:"
  pnpm audit --json | jq '.vulnerabilities'
  echo ""
  echo "System Packages:"
  apt list --upgradable
} > /var/reports/freshguard-vulnerabilities-$(date +%Y%m%d).txt
```

#### Automated Security Updates

```bash
# Configure unattended-upgrades
cat > /etc/apt/apt.conf.d/50unattended-upgrades << EOF
Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}-security";
    "\${distro_id}ESMApps:\${distro_codename}-apps-security";
    "\${distro_id}ESM:\${distro_codename}-infra-security";
};

Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Mail "admin@company.com";
EOF

# Enable automatic updates
systemctl enable unattended-upgrades
systemctl start unattended-upgrades
```

### Backup Security

#### Encrypted Backups

```bash
#!/bin/bash
# Secure backup script

BACKUP_DIR="/var/backups/freshguard"
ENCRYPTION_KEY="/etc/freshguard/backup-key.asc"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup database
sudo -u postgres pg_dump freshguard_db | \
  gpg --cipher-algo AES256 --compress-algo 1 --symmetric \
      --keyring "$ENCRYPTION_KEY" --output "$BACKUP_DIR/db_$TIMESTAMP.gpg"

# Backup configuration
tar -czf - /etc/freshguard /opt/freshguard | \
  gpg --cipher-algo AES256 --compress-algo 1 --symmetric \
      --keyring "$ENCRYPTION_KEY" --output "$BACKUP_DIR/config_$TIMESTAMP.gpg"

# Upload to secure storage
aws s3 cp "$BACKUP_DIR/" s3://company-backups/freshguard/ --recursive \
  --storage-class STANDARD_IA --server-side-encryption AES256

# Clean old local backups
find "$BACKUP_DIR" -name "*.gpg" -mtime +7 -delete

# Log backup completion
logger -t freshguard-backup "Backup completed successfully"
```

#### Backup Verification

```bash
#!/bin/bash
# Backup verification script

BACKUP_DIR="/var/backups/freshguard"
TEST_RESTORE_DIR="/tmp/freshguard-restore-test"

# Create test environment
mkdir -p "$TEST_RESTORE_DIR"

# Test database backup restoration
LATEST_DB_BACKUP=$(ls -t "$BACKUP_DIR"/db_*.gpg | head -1)
gpg --decrypt "$LATEST_DB_BACKUP" | sudo -u postgres psql test_freshguard_restore

# Verify data integrity
sudo -u postgres psql test_freshguard_restore -c "\dt"

# Test configuration backup restoration
LATEST_CONFIG_BACKUP=$(ls -t "$BACKUP_DIR"/config_*.gpg | head -1)
gpg --decrypt "$LATEST_CONFIG_BACKUP" | tar -xzf - -C "$TEST_RESTORE_DIR"

# Verify configuration files
diff -r /etc/freshguard "$TEST_RESTORE_DIR/etc/freshguard"

# Cleanup test environment
sudo -u postgres dropdb test_freshguard_restore
rm -rf "$TEST_RESTORE_DIR"

# Report results
if [ $? -eq 0 ]; then
  logger -t freshguard-backup "Backup verification successful"
  exit 0
else
  logger -t freshguard-backup "Backup verification FAILED"
  exit 1
fi
```

## Troubleshooting Security Issues

### Common Security Problems

#### Connection Failures

```bash
# Debug SSL connection issues
openssl s_client -connect database-server:5432 -starttls postgres -verify 1

# Check certificate chain
openssl verify -CAfile /etc/ssl/certs/ca.crt /etc/ssl/certs/client.crt

# Test database connectivity
sudo -u freshguard freshguard test --debug

# Check firewall rules
iptables -L -n | grep 5432
```

#### Permission Issues

```bash
# Check file permissions
ls -la /opt/freshguard/
ls -la /etc/freshguard/
ls -la /var/log/freshguard/

# Check service user permissions
su - freshguard -s /bin/bash -c "whoami && id"

# Check database permissions
sudo -u postgres psql -c "\du freshguard_monitor"
sudo -u postgres psql -c "\l" | grep freshguard
```

#### Authentication Problems

```bash
# Check environment variables
sudo -u freshguard env | grep FRESHGUARD

# Verify credential format
echo "$FRESHGUARD_DATABASE_URL" | grep -o 'postgresql://[^:]*:[^@]*@[^/]*'

# Test authentication manually
psql "$FRESHGUARD_DATABASE_URL" -c "SELECT current_user;"
```

### Security Log Analysis

#### Analyzing Failed Connections

```bash
# PostgreSQL connection failures
grep "FATAL\|authentication failed" /var/log/postgresql/postgresql-*.log

# FreshGuard application errors
grep -i "security\|auth\|failed" /var/log/freshguard/*.log | tail -20

# System authentication failures
grep "authentication failure\|Failed password" /var/log/auth.log
```

#### SQL Injection Attempt Detection

```bash
# Look for blocked SQL injection attempts
grep -i "security.*sql\|blocked.*query" /var/log/freshguard/*.log

# Check for suspicious patterns in logs
grep -E "(union|select|drop|insert|update|delete).*(\||'|--|/\*)" /var/log/freshguard/*.log

# Analyze blocked requests by IP
grep "SECURITY" /var/log/freshguard/*.log | \
  grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | sort | uniq -c | sort -nr
```

### Performance Security Issues

#### Connection Pool Exhaustion

```bash
# Check database connection usage
sudo -u postgres psql -c "SELECT count(*) as connections, usename FROM pg_stat_activity GROUP BY usename;"

# Monitor connection timeouts
grep -i timeout /var/log/freshguard/*.log | tail -10

# Check connection pool settings
grep -i "pool\|connection" /etc/freshguard/.env
```

#### Query Timeout Issues

```bash
# Analyze slow queries
sudo -u postgres psql -c "SELECT query, state, query_start FROM pg_stat_activity WHERE state != 'idle';"

# Check timeout configuration
grep TIMEOUT /etc/freshguard/.env

# Review query patterns
grep -i "query.*timeout\|slow" /var/log/freshguard/*.log
```

### Emergency Recovery Procedures

#### Complete System Compromise

```bash
#!/bin/bash
# Emergency recovery procedure

echo "EMERGENCY: FreshGuard system compromise detected"
echo "Starting emergency recovery procedure..."

# 1. Immediate isolation
iptables -P INPUT DROP
iptables -P OUTPUT DROP
systemctl stop freshguard

# 2. Evidence preservation
mkdir -p /forensics/$(date +%Y%m%d-%H%M%S)
cp -r /var/log/freshguard/ /forensics/$(date +%Y%m%d-%H%M%S)/
cp -r /etc/freshguard/ /forensics/$(date +%Y%m%d-%H%M%S)/

# 3. System analysis
ps auxf > /forensics/$(date +%Y%m%d-%H%M%S)/processes.txt
netstat -tulpn > /forensics/$(date +%Y%m%d-%H%M%S)/network.txt
find /opt/freshguard -type f -exec md5sum {} \; > /forensics/$(date +%Y%m%d-%H%M%S)/checksums.txt

# 4. Credential rotation
/usr/local/bin/emergency-credential-rotation.sh

# 5. System rebuild
echo "Initiating system rebuild from known-good state..."
/usr/local/bin/rebuild-freshguard.sh

echo "Emergency recovery initiated. Contact security team immediately."
```

#### Database Breach Response

```bash
#!/bin/bash
# Database breach response

# Immediately revoke all FreshGuard database access
sudo -u postgres psql -c "ALTER USER freshguard_monitor NOLOGIN;"

# Change all database passwords
sudo -u postgres psql -c "ALTER USER freshguard_monitor PASSWORD '$(openssl rand -base64 32)';"

# Audit all database connections
sudo -u postgres psql -c "SELECT * FROM pg_stat_activity WHERE usename = 'freshguard_monitor';"

# Check for unauthorized queries
sudo -u postgres psql -c "SELECT query, query_start, state FROM pg_stat_activity WHERE usename = 'freshguard_monitor' AND state != 'idle';"

# Review recent database logs
grep freshguard_monitor /var/log/postgresql/postgresql-*.log | tail -100

# Generate incident report
{
  echo "DATABASE BREACH INCIDENT REPORT"
  echo "Timestamp: $(date)"
  echo "Affected User: freshguard_monitor"
  echo "Actions Taken:"
  echo "- User access revoked"
  echo "- Password changed"
  echo "- Connections audited"
  echo "- Logs reviewed"
  echo ""
  echo "Next Steps:"
  echo "- Full forensic analysis"
  echo "- System rebuild"
  echo "- Stakeholder notification"
} > /var/incident/database-breach-$(date +%Y%m%d-%H%M%S).txt

echo "Database breach response completed. System secured."
```

## Conclusion

This security guide provides comprehensive protection for FreshGuard Core deployments. Remember that security is an ongoing process, not a one-time setup. Regular reviews, updates, and monitoring are essential for maintaining a secure monitoring environment.

### Key Security Principles

1. **Defense in Depth** - Multiple layers of security controls
2. **Least Privilege** - Minimum required permissions only
3. **Regular Updates** - Keep all components up to date
4. **Monitor Everything** - Comprehensive logging and monitoring
5. **Test Regularly** - Verify security controls work as expected
6. **Document Everything** - Maintain security documentation
7. **Train Your Team** - Ensure everyone understands security procedures

### Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CIS Controls](https://www.cisecurity.org/controls/)
- [PostgreSQL Security Documentation](https://www.postgresql.org/docs/current/security.html)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)

For additional support or security questions, please contact the FreshGuard security team or file an issue in the GitHub repository.