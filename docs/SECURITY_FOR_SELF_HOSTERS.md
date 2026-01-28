# Security Considerations for Self-Hosters

**FreshGuard Core - Security Guidelines**

This guide covers basic security considerations when self-hosting FreshGuard Core. These are general recommendations - you should adapt them to your specific environment and security requirements.

## Table of Contents

- [Security Overview](#security-overview)
- [What FreshGuard Core Protects Against](#what-freshguard-core-protects-against)
- [What You Need to Secure](#what-you-need-to-secure)
- [Basic Security Checklist](#basic-security-checklist)
- [Database Security](#database-security)
- [Application Security](#application-security)
- [Additional Considerations](#additional-considerations)

## Security Overview

FreshGuard Core includes basic security features, but **you are responsible for operational security**:

- **Built-in protections** - Input validation, SQL injection prevention, secure connections
- **Your responsibility** - Network security, credential management, infrastructure hardening
- **Principle of least privilege** - Use read-only database users
- **Secure by default** - SSL connections enabled by default

### Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Network Security Layer                   │
│                   (Your Responsibility)                     │
├─────────────────────────────────────────────────────────────┤
│                  Infrastructure Security                    │
│                   (Your Responsibility)                     │
├─────────────────────────────────────────────────────────────┤
│                   Application Security                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              FreshGuard Core                        │    │
│  │  • Input validation        • Error sanitization    │    │
│  │  • SQL injection prevention • Timeout protection   │    │
│  │  • Secure connectors       • Basic logging         │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                    Database Security                        │
│                   (Your Responsibility)                     │
└─────────────────────────────────────────────────────────────┘
```

## What FreshGuard Core Protects Against

✅ **Basic SQL Injection** - Input validation and parameterized queries
✅ **Path Traversal** - Safe file handling for configuration and DuckDB files
✅ **Information Disclosure** - Error message sanitization
✅ **Basic DoS** - Connection and query timeouts

## What You Need to Secure

⚠️ **Network Security** - Firewalls, network isolation
⚠️ **Operating System** - Keep your OS updated and hardened
⚠️ **Database Security** - Proper user permissions and SSL
⚠️ **Credential Management** - Secure storage of database credentials
⚠️ **Infrastructure** - Container security, access controls

## Basic Security Checklist

### Application Setup
- [ ] Set `NODE_ENV=production`
- [ ] Use environment variables for all credentials
- [ ] Enable SSL for database connections
- [ ] Use dedicated read-only database users

### Infrastructure Basics
- [ ] Keep your operating system updated
- [ ] Configure basic firewall rules
- [ ] Use strong, unique passwords
- [ ] Don't expose database ports to the internet

### Database Security
- [ ] Create dedicated read-only database user for FreshGuard
- [ ] Grant only SELECT permissions
- [ ] Enable SSL/TLS connections
- [ ] Use strong passwords

### Docker (if applicable)
- [ ] Run containers as non-root user
- [ ] Use secrets for credentials (not environment variables in production)
- [ ] Keep base images updated

## Database Security

### General Database Setup

**Create a dedicated read-only user:**

```sql
-- PostgreSQL example
CREATE USER freshguard_readonly WITH PASSWORD 'strong_random_password';
GRANT CONNECT ON DATABASE your_database TO freshguard_readonly;
GRANT USAGE ON SCHEMA public TO freshguard_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO freshguard_readonly;
```

**Enable SSL connections:**

```bash
# Connection string with SSL
export FRESHGUARD_DATABASE_URL="postgresql://user:password@host:5432/db?sslmode=require"
```

### Database-Specific Notes

**PostgreSQL:**
- Use `sslmode=require` in connection string
- Create dedicated user with SELECT permissions only
- Consider using certificate-based authentication

**BigQuery:**
- Create service account with BigQuery Data Viewer and Job User roles
- Store service account JSON securely
- Use IAM to restrict dataset access

**DuckDB:**
- Store database files with appropriate file permissions (640)
- Use absolute file paths to prevent path traversal

**Snowflake:**
- Use dedicated warehouse for monitoring queries
- Set up role with minimal privileges
- Consider using key-pair authentication

For detailed database-specific setup, consult your database's security documentation.

## Application Security

### Environment Variables

Store all sensitive configuration in environment variables:

```bash
# Required
DB_HOST=your_database_host
DB_USER=freshguard_readonly
DB_PASSWORD=your_secure_password
DB_NAME=your_database

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

### File Permissions

If running on Linux, ensure proper file permissions:

```bash
# Set restrictive permissions on configuration files
chmod 600 .env
chmod 600 config/*.json

# Run as dedicated user (not root)
useradd -m -s /bin/bash freshguard
```

### Process Security

**Systemd Service (Linux):**

```ini
[Unit]
Description=FreshGuard Monitor
After=network.target

[Service]
Type=simple
User=freshguard
WorkingDirectory=/opt/freshguard
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

# Security settings
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

## Additional Considerations

### Network Security
- Use firewalls to restrict access
- Don't expose database ports to the internet
- Consider VPN for remote administration
- Use private networks when possible

### Monitoring
- Monitor FreshGuard logs for errors
- Set up alerts for connection failures
- Track resource usage
- Review access logs periodically

### Updates
- Keep FreshGuard Core updated
- Update dependencies regularly
- Apply OS security patches
- Monitor security advisories

### Backup and Recovery
- Back up your configuration
- Test your backup/restore procedures
- Consider disaster recovery planning
- Document your setup

## Getting Help

For security questions:
- Check the documentation first
- Search GitHub Issues for similar problems
- Open a new issue if needed
- Follow responsible disclosure for security vulnerabilities

## Disclaimer

These are general security recommendations. Your specific environment may require additional security measures. Always consult with security professionals for production deployments handling sensitive data.