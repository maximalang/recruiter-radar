process.env.NODE_ENV = 'test'
const { createOperatorAuthServer } = await import('./server.js')
process.env.NODE_ENV = 'production'

const { server } = await createOperatorAuthServer()
server.listen(3002, '0.0.0.0', () => {
  console.info(JSON.stringify({
    ts: new Date().toISOString(),
    component: 'operator-auth',
    event: 'service_started',
    status: 'ready',
  }))
})
