# Production Deployment Guide

## Environment Configuration

### Environment Variables

Set `NODE_ENV` to configure the application for different environments:

```bash
# Development (default)
NODE_ENV=development

# Production
NODE_ENV=production

# Staging
NODE_ENV=staging

# Testing
NODE_ENV=testing
```

### Operational Modes

Set `OPERATIONAL_MODE` to configure feature sets:

```bash
# Full features (default for development)
OPERATIONAL_MODE=full-features

# Collection only (recommended for production)
OPERATIONAL_MODE=collect-only

# Monitoring mode (for staging/debugging)
OPERATIONAL_MODE=monitor

# Maintenance mode
OPERATIONAL_MODE=maintenance
```

### Feature Flags

Override specific features with environment variables:

```bash
# Core features
ENABLE_ADVANCED_LOGGING=true
ENABLE_PERFORMANCE_METRICS=true
ENABLE_DATA_VALIDATION=true
ENABLE_FILE_INTEGRITY_CHECKS=true
ENABLE_AUTO_RECOVERY=true
ENABLE_BACKUP_CREATION=true
ENABLE_STATISTICS_REPORTING=true
ENABLE_HEALTH_CHECKS=true

# Performance settings
MAX_MEMORY_USAGE_MB=1024
CONNECTION_POOL_SIZE=10
REQUEST_TIMEOUT_MS=15000

# Monitoring settings
HEALTH_CHECK_PORT=8080
METRICS_COLLECTION_INTERVAL=300000
LOG_LEVEL=info
```

## Health Checks

The application provides several health check endpoints:

### Health Check Endpoint

```bash
GET /health
```

Returns comprehensive system health including all components.

### Readiness Check

```bash
GET /ready
```

Returns whether the system is ready to serve requests.

### Liveness Check

```bash
GET /live
```

Returns whether the system is alive and responding.

### Metrics Endpoint

```bash
GET /metrics
```

Returns Prometheus-compatible metrics.

## Monitoring

### System Metrics

The application automatically monitors:

- **Memory Usage**: Heap, external memory, and total usage percentages
- **CPU Usage**: User and system CPU time with percentage calculations
- **Event Loop Lag**: Measures event loop responsiveness
- **Request Performance**: Request counts, response times, error rates
- **Garbage Collection**: GC frequency and duration (when enabled)

### Performance Thresholds

Default alerting thresholds:

| Metric         | Warning | Critical |
| -------------- | ------- | -------- |
| Memory Usage   | 80%     | 95%      |
| CPU Usage      | 70%     | 90%      |
| Event Loop Lag | 50ms    | 100ms    |
| Error Rate     | 5%      | 10%      |

### Log Levels

- **Production**: `info` level (errors, warnings, important events)
- **Staging**: `debug` level (detailed debugging information)
- **Development**: `debug` level (all logging output)
- **Testing**: `debug` level (verbose test output)

## Deployment Configurations

### Production Environment

```bash
NODE_ENV=production
OPERATIONAL_MODE=collect-only
LOG_LEVEL=info
MAX_MEMORY_USAGE_MB=1024
HEALTH_CHECK_PORT=8080
ENABLE_PERFORMANCE_METRICS=true
ENABLE_ADVANCED_LOGGING=false
ENABLE_DATA_VALIDATION=true
ENABLE_FILE_INTEGRITY_CHECKS=true
ENABLE_AUTO_RECOVERY=true
ENABLE_BACKUP_CREATION=true
ENABLE_HEALTH_CHECKS=true
METRICS_COLLECTION_INTERVAL=300000
```

**Features enabled in production:**

- Data validation and integrity checks
- Automatic error recovery
- File backups
- Health monitoring
- Memory optimization
- Rate limiting
- Secure mode

**Features disabled in production:**

- Advanced/verbose logging
- Debug endpoints
- Development tools

### Staging Environment

```bash
NODE_ENV=staging
OPERATIONAL_MODE=monitor
LOG_LEVEL=debug
MAX_MEMORY_USAGE_MB=512
HEALTH_CHECK_PORT=8080
ENABLE_ADVANCED_LOGGING=true
METRICS_COLLECTION_INTERVAL=120000
```

**Purpose**: Pre-production testing with production-like settings but enhanced logging.

### Development Environment

```bash
NODE_ENV=development
OPERATIONAL_MODE=full-features
LOG_LEVEL=debug
MAX_MEMORY_USAGE_MB=512
HEALTH_CHECK_PORT=8080
ENABLE_ADVANCED_LOGGING=true
ENABLE_PERFORMANCE_METRICS=true
```

**Purpose**: Full feature set with detailed logging for development.

## Security Configuration

### Production Security Settings

- **Secure Mode**: Enabled automatically in production
- **Rate Limiting**: Protects against abuse
- **Session Management**: Shorter session timeouts
- **Login Attempts**: Limited failed login attempts
- **Data Validation**: Strict input validation

### Environment-Specific Security

| Setting            | Development | Staging | Production |
| ------------------ | ----------- | ------- | ---------- |
| Secure Mode        | Disabled    | Enabled | Enabled    |
| Max Login Attempts | 10          | 5       | 3          |
| Session Timeout    | 1 hour      | 30 min  | 30 min     |
| Rate Limiting      | Disabled    | Enabled | Enabled    |

## Performance Optimization

### Memory Management

- **Garbage Collection**: Enabled in production for optimal memory usage
- **Memory Monitoring**: Continuous tracking with automatic alerts
- **Cache Optimization**: Intelligent caching with size limits
- **Memory Thresholds**: Automatic cleanup when limits approached

### Connection Management

- **Connection Pooling**: Configurable pool sizes for different environments
- **Timeout Settings**: Environment-specific timeout configurations
- **Retry Logic**: Intelligent retry with exponential backoff
- **Circuit Breakers**: Automatic failover for failed connections

### Event Loop Optimization

- **Event Loop Monitoring**: Tracks event loop lag in real-time
- **Async Operations**: Non-blocking I/O for optimal performance
- **Load Balancing**: Distributes processing load efficiently

## Graceful Shutdown

The application supports graceful shutdown with:

1. **Signal Handling**: Responds to SIGTERM and SIGINT
2. **Component Shutdown**: Orderly shutdown of all components
3. **Health Check Updates**: Updates health status during shutdown
4. **Timeout Protection**: Maximum shutdown time limit
5. **Final Statistics**: Reports final metrics before exit

## Monitoring Integration

### Prometheus Metrics

The `/metrics` endpoint provides:

- System health status metrics
- Component response times
- Resource usage metrics
- Request/error counters
- Custom business metrics

### Health Check Integration

Compatible with:

- **Kubernetes**: Liveness and readiness probes
- **Docker**: Health check commands
- **Load Balancers**: Backend health checks
- **Monitoring Systems**: External monitoring integration

## Configuration Validation

The application validates configuration on startup:

- **Environment Variables**: Required variables presence
- **Value Ranges**: Numeric values within acceptable ranges
- **Feature Compatibility**: Feature flag consistency
- **Resource Limits**: Memory and performance limits
- **Security Settings**: Security configuration validation

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Check cache sizes and enable memory optimization
2. **High Event Loop Lag**: Review async operations and connection pools
3. **Health Check Failures**: Verify component health and dependencies
4. **Configuration Errors**: Check environment variables and validation logs

### Debug Mode

Enable debug logging in production (temporarily):

```bash
LOG_LEVEL=debug
ENABLE_ADVANCED_LOGGING=true
```

**Warning**: Only enable temporarily as it impacts performance.

## Best Practices

1. **Use Environment-Specific Configurations**: Don't mix development and production settings
2. **Monitor Health Endpoints**: Set up monitoring for all health check endpoints
3. **Configure Alerts**: Set up alerts for critical thresholds
4. **Regular Health Checks**: Monitor system health continuously
5. **Graceful Deployments**: Use health checks for zero-downtime deployments
6. **Resource Limits**: Set appropriate memory and CPU limits
7. **Log Management**: Configure appropriate log levels for each environment
8. **Security Updates**: Keep security settings updated and validated
