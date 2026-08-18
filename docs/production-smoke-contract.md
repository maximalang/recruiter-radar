# Production smoke contract

After deployment the runtime verification must cover:

- `/`
- `/login`
- `/dashboard`
- `/leads`
- `/opportunities`
- `/settings`
- `/api/health`
- `/api/version`

Required runtime identity:

```json
{
  "gitSha": "...",
  "buildTime": "...",
  "environment": "production",
  "runtimeVersion": "..."
}
```

Deployment verification must compare:

Git commit SHA → Docker image tag → running container → public runtime response.
