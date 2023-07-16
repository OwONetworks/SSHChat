const ssh2 = require('ssh2')
const fs = require('fs')

const messages = []
const renders = {}

const server = new ssh2.Server({
  hostKeys: [fs.readFileSync('./keys/host.key')],
}, (client) => {
  let stdout = null
  let height = 0
  let width = 0
  let username = ''

  client.on('authentication', (ctx) => {
    ctx.accept()
    username = ctx.username
  })
  
  const position = [0, 0]
  const inputCache = []

  const draw = () => {
    const write = stdout.write.bind(stdout)

    write('\x1b[2J')
    write('\x1b[0;0H')

    const latestMessages = messages.slice(-height + 4).reverse()

    for (let i = 0; i < height - 3; i++) {
      const isFirst = i === 0
      const isLast = i === height - 4

      if (isFirst) {
        write('┌')
        write('─'.repeat(width - 2))
        write('┐')
      }

      if (isLast) {
        write('├')
        write('─'.repeat(width - 2))
        write('┤')
      }

      if (!isFirst && !isLast) {
        write('│')
        const currentLine = i + 1
        const messageOffset = height - 4 - currentLine
        const message = latestMessages[messageOffset]
        if (message) {
          write(` ${message}${' '.repeat(width - 4 - message.length)} `)
        } else {
          write(' '.repeat(width - 2))
        }
        write('│')
      }
    }

    write('| > ')

    const str = inputCache.join('')
    if (str) {
      write(str)
      write(' '.repeat(width - 5 - str.length))
    } else {
      write(' '.repeat(width - 5))
    }

    console.log(`position: ${position}`)
    console.log(`inputCache: ${inputCache.join('')}`)

    write('|')

    write('└')
    write('─'.repeat(width - 2))
    write('┘')

    const x = position[0]
    const y = position[1]
    write(`\x1b[${y};${x}H`)
  }

  client.on('ready', () => {
    // client ready
    client.on('session', (accept, reject) => {
      const session = accept()

      session.on('pty', (accept, reject, info) => {
        accept()

        height = info.rows
        width = info.cols

        console.log(`window change: ${width}x${height}`)
      })

      session.on('window-change', (accept, reject, info) => {
        height = info.rows
        width = info.cols

        console.log(`window change: ${width}x${height}`)
      })

      session.on('shell', (accept, reject) => {
        const shell = accept()

        stdout = shell.stdout

        const write = stdout.write.bind(stdout)

        // 移动光标
        const moveCursor = (x, y) => {
          write(`\x1b[${y};${x}H`)
          position[0] = x
          position[1] = y
        }

        renders[username] = draw

        draw()
        moveCursor(5, height - 2)

        shell.stdin.on('data', (data) => {
          // 处理删除，退格，回车，左右，不处理上下
          const hex = data.toString('hex')
          if (data[0] === 0x7f) {
            // 退格
            if (inputCache.pop()) moveCursor(position[0] - 1, position[1])
          } else if (hex === '0d') {
            // 回车
            const input = inputCache.join('')
            if (input) {
              if (input === '/quit') {
                client.end()
                delete renders[username]
                return
              }

              inputCache.length = 0
              messages.push(`${username}: ${input}`)
              moveCursor(5, height - 2)
              Object.values(renders).forEach((render) => render())
            }
          } else if (data[0] === 0x1b && data[1] === 0x5b && data[2] === 0x44) {
            // 左
            const minX = 3
            const X = position[0] - 1
            const Y = position[1]
            const isMinX = X === minX
            if (!isMinX) {
              moveCursor(X - 1, Y)
            }
          } else if (data[0] === 0x1b && data[1] === 0x5b && data[2] === 0x43) {
            // 右
            const maxX = inputCache.length + 3
            const X = position[0] - 1
            const Y = position[1]
            const isMaxX = X === maxX
            if (!isMaxX) {
              moveCursor(X + 1, Y)
            }
          } else {
            // 判断是否为可打印字符
            const string = data.toString()
            if (string.match(/[\x20-\x7e]/)) {
              inputCache.push(data.toString())
              moveCursor(position[0] + 1, position[1])
            }
          }

          draw()
        })
      })
    })

    client.on('close', () => {
      console.log('client close')
      delete renders[username]
    })

    client.on('error', (err) => {
      console.log('client error', err)
      delete renders[username]
    })
  })
})

server.listen(10022, '0.0.0.0')
