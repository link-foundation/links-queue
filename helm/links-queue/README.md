# Links Queue Helm Chart

A Helm chart for deploying Links Queue on Kubernetes.

## Installation

```bash
# Add the repository (when published)
# helm repo add link-foundation https://link-foundation.github.io/charts
# helm repo update

# Install from local chart
helm install links-queue ./helm/links-queue

# Install with custom values
helm install links-queue ./helm/links-queue -f custom-values.yaml

# Install with inline values
helm install links-queue ./helm/links-queue \
  --set replicaCount=3 \
  --set autoscaling.enabled=true
```

## Configuration

### Basic Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `image.repository` | Image repository | `ghcr.io/link-foundation/links-queue` |
| `image.tag` | Image tag | `""` (uses appVersion) |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |

### Links Queue Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.host` | Server host binding | `0.0.0.0` |
| `config.port` | Server port | `5000` |
| `config.maxConnections` | Maximum connections | `1000` |
| `config.idleTimeout` | Idle timeout (ms) | `60000` |
| `config.backend.type` | Backend type (memory/link-cli) | `memory` |
| `config.cluster.enabled` | Enable cluster mode | `false` |
| `config.cluster.seeds` | Cluster seed nodes | `[]` |

### Service Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service port | `5000` |

### Autoscaling

| Parameter | Description | Default |
|-----------|-------------|---------|
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Minimum replicas | `1` |
| `autoscaling.maxReplicas` | Maximum replicas | `10` |
| `autoscaling.targetCPUUtilizationPercentage` | CPU target | `80` |
| `autoscaling.targetMemoryUtilizationPercentage` | Memory target | `80` |

### Persistence

| Parameter | Description | Default |
|-----------|-------------|---------|
| `persistence.enabled` | Enable persistence | `false` |
| `persistence.storageClass` | Storage class | `""` |
| `persistence.size` | PVC size | `1Gi` |

## Examples

### Single Node (Development)

```yaml
# values-dev.yaml
replicaCount: 1

resources:
  limits:
    cpu: 500m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
```

### Production Cluster

```yaml
# values-prod.yaml
replicaCount: 3

config:
  cluster:
    enabled: true
    seeds:
      - links-queue-0.links-queue:5000
      - links-queue-1.links-queue:5000
      - links-queue-2.links-queue:5000

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

resources:
  limits:
    cpu: 2000m
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 512Mi

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: links-queue
          topologyKey: kubernetes.io/hostname
```

### With Ingress

```yaml
# values-ingress.yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/backend-protocol: "TCP"
  hosts:
    - host: queue.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: queue-tls
      hosts:
        - queue.example.com
```

## Uninstalling

```bash
helm uninstall links-queue
```

## License

Unlicense
