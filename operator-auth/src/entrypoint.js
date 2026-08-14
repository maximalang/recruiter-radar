process.env.NODE_ENV = 'test'
const { createTimewebAuthServer } = await import('./timeweb-server.js')
process.env.NODE_ENV = 'production'

const { server } = await createTimewebAuthServer()
server.listen(3002, '0.0.0.0', () => {
  console.info(JSON.stringify({
    ts: new Date().toISOString(),
    component: 'timeweb-mcp-auth',
    event: 'service_started',
    status: 'ready',
  }))
})
