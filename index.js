const ssh2 = require('ssh2')
const fs = require('fs')
const ttf = require('./font/ttf')

let messages = []
const renders = {}
const dings = {}

const preprocess = (text) => {
  // 全角转半角
  text = text.replace(/[\uff00-\uffff]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  })

  // 去除控制字符
  text = text.replace(/[\x00-\x1f]/g, '')

  // 匹配中文字符
  const regexp_cn = /[\u4e00-\u9fa5]/
  // 匹配英文，数字，空格和标点符号
  const regexp_en = /[\u0020-\u007e]/

  text = text.split('').filter(char => {
    return regexp_cn.test(char) || regexp_en.test(char)
  }).join('')

  return text
}

const renderText = (text, width) => {
  const items = preprocess(text).split('')
  let left = width
  let result = ''

  while (left > 0) {
    const item = items.shift()
    if (item) {
      const width = ttf.getTextWidthRate(item)
      result += item
      left -= width
    } else {
      result += ' '
      left -= 1
    }
  }

  return result
}

const getWidth = (text) => {
  const items = preprocess(text).split('')
  let width = 0

  while (items.length > 0) {
    const item = items.shift()
    if (item) {
      width += ttf.getTextWidthRate(item)
    }
  }

  return width
}

const server = new ssh2.Server({
  hostKeys: [fs.readFileSync('./keys/host.key')],
}, (client) => {
  let stdout = null
  let height = 24
  let width = 80
  let username = ''

  client.on('close', () => {
    if(renders[username]) {
      delete renders[username]
      delete dings[username]
      messages.push(`+ ${username} left`)
      Object.values(renders).forEach((render) => render())
      Object.values(dings).filter(t => t !== ding).forEach((ding) => ding())
    } else {
      const ip = client._sock.remoteAddress
      const port = client._sock.remotePort
      
      console.log(`found a ghost connection from ${ip}:${port}`)
    }
  })

  client.on('error', (err) => {
    console.log('client error', err)
    delete renders[username]
    delete dings[username]
  })

  client.on('authentication', (ctx) => {
    try {
      username = ctx.username

      if (preprocess(username) !== username) {
        ctx.reject()
        return
      }

      if (username.length > 16) {
        ctx.reject()
        return
      }

      if (renders[username] || dings[username]) {
        ctx.reject()
        return
      }

      ctx.accept()
    } catch (error) {}
  })
  
  const position = [0, 0]
  const inputCache = []

  const ding = () => {
    const write = stdout.write.bind(stdout)
    write('\x07')
  }

  const draw = () => {
    const write = stdout.write.bind(stdout)

    write('\x1b[2J')
    write('\x1b[0;0H')

    messages = messages.slice(-500)
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
        write('│ ')
        const currentLine = i + 1
        const messageOffset = height - 4 - currentLine
        const message = latestMessages[messageOffset]
        write(renderText(message || '', width - 3))
        write('│')
      }
    }

    write('│ > ')

    const str = inputCache.join('')

    if (str) {
      write(renderText(inputCache.join(''), width - 5))
    } else {
      write(' '.repeat(width - 5))
    }

    write('│')

    write('└')
    write('─'.repeat(width - 2))
    write('┘')

    write(` GitHub: OwONetworks/SSHChat | username: ${username} | window size: ${width}x${height} | Current Online: ${Object.values(renders).length}`)

    const x = position[0]
    const y = position[1]
    write(`\x1b[${y};${x}H`)
  }

  client.on('ready', () => {
    client.on('session', (accept, reject) => {
      const session = accept()

      session.on('pty', (accept, reject, info) => {
        accept()

        info.rows && (height = info.rows)
        info.cols && (width = info.cols)
      })

      session.on('window-change', (accept, reject, info) => {
        info.rows && (height = info.rows)
        info.cols && (width = info.cols)

        position[1] = height - 2
        draw()
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
        dings[username] = ding

        messages.push(`+ ${username} joined`)
        Object.values(renders).forEach((render) => render())
        Object.values(dings).filter(t => t !== ding).forEach((ding) => ding())

        draw()
        moveCursor(5, height - 2)

        shell.stdin.on('data', (data) => {
          // 处理删除，退格，回车，左右，不处理上下
          const hex = data.toString('hex')
          if (hex === '7f') {
            // 退格
            const currentX = position[0]
            const currentTextX = currentX - 6
            const textPositionMap = inputCache.map((text, index) => {
              const width = getWidth(text)
              return [width, index]
            })

            const targetText = textPositionMap.find(([width, index]) => {
              const textX = textPositionMap.slice(0, index).reduce((a, b) => a + b[0], 0)
              const textEndX = textX + width
              return textX <= currentTextX && currentTextX < textEndX
            })

            if (targetText) {
              const index = targetText[1]
              inputCache.splice(index, 1)
              moveCursor(currentX - targetText[0], position[1])
            }
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
              Object.values(dings).filter(t => t !== ding).forEach((ding) => ding())
            }
          } else if (hex === "1b5b44") {
            // 左
            const minX = 4
            const X = position[0] - 1
            const Y = position[1]
            const isMinX = X <= minX
            if (!isMinX) {
              moveCursor(X, Y)
            }
          } else if (hex === "1b5b43") {
            // 右
            const maxX = inputCache.length + 3
            const X = position[0] + 1
            const Y = position[1]
            const isMaxX = X >= maxX
            if (!isMaxX) {
              moveCursor(X, Y)
            }
          } else {
            // 判断是否为特殊按键
            const str = preprocess(data.toString())
            if (!str) return
            inputCache.push(...str.split(''))
            moveCursor(position[0] + getWidth(data.toString()), position[1])
          }

          draw()
        })
      })
    })
  })
})

server.listen(10022, '0.0.0.0')
