const child_process = require('child_process')
const debug = require('debug')
const fs = require('fs')
const path = require('path')
const Umzug = require('umzug')
const config = require('../../config')
const { db } = require('../db')

const log = debug('scripts:migrate')

const umzug = new Umzug({
  storage: 'sequelize',
  storageOptions: {
    sequelize: db,
  },

  // see: https://github.com/sequelize/umzug/issues/17
  migrations: {
    params: [
      db.getQueryInterface(), // queryInterface
      db.constructor, // DataTypes
      () => {
        throw new Error(
          'Migration tried to use old style "done" callback. Please upgrade to "umzug" and return a promise instead.',
        )
      },
    ],
    path: __dirname + '/../migrations',
    pattern: /\.js$/,
  },

  logging: log,
})

function logUmzugEvent(eventName) {
  return (name, migration) => {
    console.log(`${name} ${eventName}`)
  }
}
umzug.on('migrating', logUmzugEvent('migrating'))
umzug.on('migrated', logUmzugEvent('migrated'))
umzug.on('reverting', logUmzugEvent('reverting'))
umzug.on('reverted', logUmzugEvent('reverted'))

function cmdStatus() {
  const result = {}

  return umzug
    .executed()
    .then(executed => {
      result.executed = executed
      return umzug.pending()
    })
    .then(pending => {
      result.pending = pending
      return result
    })
    .then(({ executed, pending }) => {
      executed = executed.map(m => {
        m.name = path.basename(m.file, '.js')
        return m
      })
      pending = pending.map(m => {
        m.name = path.basename(m.file, '.js')
        return m
      })

      const current = executed.length > 0 ? executed[0].file : '<NO_MIGRATIONS>'
      const status = {
        current,
        executed: executed.map(m => m.file),
        pending: pending.map(m => m.file),
      }

      console.log(JSON.stringify(status, null, 2))

      return { executed, pending }
    })
}

function cmdMigrate() {
  return umzug.up()
}

function cmdMigrateNext() {
  return cmdStatus().then(({ executed, pending }) => {
    if (pending.length === 0) {
      return Promise.reject(new Error('No pending migrations'))
    }
    const next = pending[0].name
    return umzug.up({ to: next })
  })
}

function cmdReset() {
  return umzug.down({ to: 13 })
}

function cmdResetPrev() {
  return cmdStatus().then(({ executed, pending }) => {
    if (executed.length === 0) {
      return Promise.reject(new Error('Already at initial state'))
    }
    const prev = executed[executed.length - 1].name
    return umzug.down({ to: prev })
  })
}

function cmdHardReset() {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        console.log(`dropdb ${config.DB.DATABASE}`)
        child_process.spawnSync(`dropdb ${config.DB.DATABASE}`)
        console.log(
          `createdb ${config.DB.DATABASE} --username ${config.DB.USERNAME}`,
        )
        child_process.spawnSync(
          `createdb ${config.DB.DATABASE} --username ${config.DB.USERNAME}`,
        )
        resolve()
      } catch (e) {
        console.log(e)
        reject(e)
      }
    })
  })
}

function cmdCreate(filename) {
  return new Promise((resolve, reject) => {
    fs.writeFile(
      path.join(
        __dirname,
        '../migrations/99_' +
          Math.floor(+new Date() / 1000) +
          `_${filename}.js`,
      ),
      `
module.exports = {
  up(query, DataTypes) {
  },
  down(query, DataTypes) {
  }
}
    `,
      err => {
        if (err) {
          return reject(err)
        }

        resolve()
      },
    )
  })
}

const cmd = process.argv[2].trim()
let executedCmd

console.log(`${cmd.toUpperCase()} BEGIN`)
switch (cmd) {
  case 'status':
    executedCmd = cmdStatus()
    break

  case 'up':
  case 'migrate':
    executedCmd = cmdMigrate()
    break

  case 'next':
  case 'migrate-next':
    executedCmd = cmdMigrateNext()
    break

  case 'down':
  case 'reset':
    executedCmd = cmdReset()
    break

  case 'prev':
  case 'reset-prev':
    executedCmd = cmdResetPrev()
    break

  case 'reset-hard':
    executedCmd = cmdHardReset()
    break

  case 'create':
    executedCmd = cmdCreate(process.argv[3].trim())
    break

  default:
    console.log(`invalid cmd: ${cmd}`)
    process.exit(1)
}

executedCmd
  .then(result => {
    const doneStr = `${cmd.toUpperCase()} DONE`
    console.log(doneStr)
    console.log('='.repeat(doneStr.length))
  })
  .catch(err => {
    const errorStr = `${cmd.toUpperCase()} ERROR`
    console.log(errorStr)
    console.log('='.repeat(errorStr.length))
    console.log(err)
    console.log('='.repeat(errorStr.length))
  })
  .then(() => {
    if (cmd !== 'status' && cmd !== 'reset-hard') {
      return cmdStatus()
    }
    return Promise.resolve()
  })
  .then(() => process.exit(0))
