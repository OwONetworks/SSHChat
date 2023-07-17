const fs = require('fs')

const fontCache = {}

const loadFont = (font) => {
  if (fontCache[font]) return fontCache[font]

  const fontData = fs.readFileSync(__dirname + `/${font}`)

  const binaryFile = buffer => {
    const data = new Uint8Array(buffer)
    let position = 0

    const getUint8 = () => data[position++]
    const getUint16 = () => ((getUint8() << 8) | getUint8()) >>> 0
    const getUint32 = () => getInt32() >>> 0
    const getInt16 = () => {
      let number = getUint16()
      if (number & 0x8000) number -= 1 << 16
      return number
    }

    const getInt32 = () => (getUint8() << 24) | (getUint8() << 16) | (getUint8() << 8) | getUint8()
    const getFWord = getInt16
    const getUFWord = getUint16
    const getOffset16 = getUint16
    const getOffset32 = getUint32
    const getF2Dot14 = () => getInt16() / (1 << 14)
    const getFixed = () => getInt32() / (1 << 16)
    const getString = length => {
      let string = ''
      for (let i = 0; i < length; i++) {
        string += String.fromCharCode(getUint8())
      }
      return string
    }

    const getDate = () => {
      const macTime = getUint32() * 0x100000000 + getUint32()
      const utcTime = macTime * 1000 + Date.UTC(1904, 1, 1)
      return new Date(utcTime)
    }

    const getPosition = () => position
    const setPosition = targetPosition => (position = targetPosition)

    return {
      getUint8,
      getUint16,
      getUint32,
      getInt16,
      getInt32,
      getFWord,
      getUFWord,
      getOffset16,
      getOffset32,
      getF2Dot14,
      getFixed,
      getString,
      getDate,
      getPosition,
      setPosition,
    }
  }

  const reader = binaryFile(fontData)

  const sfntVersion = reader.getString(4)
  const numTables = reader.getUint16()
  const searchRange = reader.getUint16()
  const entrySelector = reader.getUint16()
  const rangeShift = reader.getUint16()

  const tables = []

  for (let i = 0; i < numTables; i++) {
    const tag = reader.getString(4)
    const checkSum = reader.getUint32()
    const offset = reader.getUint32()
    const length = reader.getUint32()
    tables.push({ tag, checkSum, offset, length })
  }

  const cmapTable = tables.find(table => table.tag === 'cmap')
  const cmapReader = binaryFile(fontData.slice(cmapTable.offset, cmapTable.offset + cmapTable.length))

  const cmapVersion = cmapReader.getUint16()
  const cmapNumTables = cmapReader.getUint16()

  const cmapTables = []

  for (let i = 0; i < cmapNumTables; i++) {
    const cmapPlatformID = cmapReader.getUint16()
    const cmapEncodingID = cmapReader.getUint16()
    const cmapOffset = cmapReader.getUint32()
    cmapTables.push({ cmapPlatformID, cmapEncodingID, cmapOffset })
  }

  const codeMap = {}

  for (let i = 0; i < cmapTables.length; i++) {
    const code = cmapTables[i].cmapPlatformID << 16 | cmapTables[i].cmapEncodingID
    const gid = cmapTables[i].cmapOffset

    codeMap[code] = gid
  }

  const headTable = tables.find(table => table.tag === 'head')
  const headReader = binaryFile(fontData.slice(headTable.offset, headTable.offset + headTable.length))

  const headVersion = headReader.getFixed()
  const headFontRevision = headReader.getFixed()
  const headCheckSumAdjustment = headReader.getUint32()
  const headMagicNumber = headReader.getUint32()
  const headFlags = headReader.getUint16()
  const headUnitsPerEm = headReader.getUint16()
  const headIndexToLocFormat = headReader.getInt16()

  const glyphTable = tables.find(table => table.tag === 'glyf')
  const glyphReader = binaryFile(fontData.slice(glyphTable.offset, glyphTable.offset + glyphTable.length))

  const glyphData = []

  while (glyphReader.getPosition() < glyphTable.length) {
    const numberOfContours = glyphReader.getInt16()
    const xMin = glyphReader.getFWord()
    const yMin = glyphReader.getFWord()
    const xMax = glyphReader.getFWord()
    const yMax = glyphReader.getFWord()
    glyphData.push({ numberOfContours, xMin, yMin, xMax, yMax })
  }

  const hmtxTable = tables.find(table => table.tag === 'hmtx')
  const hmtxReader = binaryFile(fontData.slice(hmtxTable.offset, hmtxTable.offset + hmtxTable.length))

  const hmtxData = []

  for (let i = 0; i < glyphData.length; i++) {
    const advanceWidth = hmtxReader.getUint16()
    const leftSideBearing = hmtxReader.getInt16()
    hmtxData.push({ advanceWidth, leftSideBearing })
  }

  const data = {
    codeMap,
    headUnitsPerEm,
    hmtxData,
  }

  fontCache[font] = data

  return data
}

const getTextWidthByFont = (text, font, fontSize) => {
  const {
    codeMap,
    headUnitsPerEm,
    hmtxData,
  } = loadFont(font)

  let width = 0

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const gid = codeMap[0 << 16 | 3] + code

    width += hmtxData[gid].advanceWidth
  }

  return width * fontSize / headUnitsPerEm
}

const getTextWidth = (text, fontSize = 16) => {
  if (text.match(/\0x00-\0x7f/)) {
    return text.length * fontSize
  }
  const files = fs.readdirSync(__dirname)
  const fonts = files.filter(file => file.endsWith('.ttf'))

  const widthList = fonts.map(font => {
    try {
      return getTextWidthByFont(text, font, fontSize)
    } catch (error) {
      console.log(`font ${font} error`)
      return null
    }
  })
  const avg = widthList.filter(width => width !== null).reduce((sum, width) => sum + width, 0) / widthList.filter(width => width !== null).length

  return avg
}

const getTextWidthRate = (text) => {
  const width = getTextWidth(text, 16)
  const rate = width / 16 * 2
  return Math.round(rate)
}

module.exports = {
  getTextWidth,
  getTextWidthRate,
}

'风间苏苏: clear'.split('').forEach(char => console.log(char, getTextWidthRate(char)))
