const babel = require('@babel/core')
const chalk = require('chalk')
const clear = require('clear')
const diff = require('diff')
const fs = require('fs')
const path = require('path')

const pluginPath = require.resolve('../src')

function runTests() {
  const testsPath = path.resolve(__dirname, 'fixtures')

  fs.readdirSync(testsPath)
    .map(function (item) {
      return {
        path: path.join(testsPath, item),
        name: item,
      }
    })
    .filter(function (item) {
      return fs.statSync(item.path).isDirectory()
    })
    .forEach(runTest)
}

function loadOpts(dir) {
  const optsPath = path.resolve(dir.path, 'opts.json')
  if (fs.existsSync(optsPath)) {
    return JSON.parse(fs.readFileSync(optsPath, 'utf8'))
  } else {
    return { opts: {}, plugins: [] };
  }
}

function runTest(dir) {
  const opts = loadOpts(dir);
  const output = babel.transformFileSync(path.resolve(dir.path, 'actual.js'), {
    babelrc: false,
    plugins: [[pluginPath, opts.opts]].concat(opts.plugins),
  })

  const expected = fs.readFileSync(path.resolve(dir.path, 'expected.js'), 'utf-8')

  function normalizeLines(str) {
    return str.replace(/\r\n/g, '\n').trimRight()
  }

  const normalizedOutput = normalizeLines(output.code)
  const normalizedExpected = normalizeLines(expected)

  if (normalizedOutput === normalizedExpected) {
    process.stdout.write(chalk.bgWhite.black(dir.name) + ' ' + chalk.green('OK'))
  } else {
    process.stdout.write(chalk.bgWhite.black(dir.name) + ' ' + chalk.red('Different'))
    process.stdout.write('\n\n')

    diff.diffLines(normalizedOutput, normalizedExpected).forEach(function (part) {
      let value = part.value.replace(/\t/g, '»   ').replace(/^\n$/, '↵\n')
      if (part.added) {
        value = chalk.green(value)
      } else if (part.removed) {
        value = chalk.red(value)
      }

      process.stdout.write(value)
    })
  }

  process.stdout.write('\n\n\n')
}

if (process.argv.indexOf('--watch') >= 0) {
  require('watch').watchTree(path.resolve(__dirname, '..'), function () {
    delete require.cache[pluginPath]
    clear()
    process.stdout.write('Press Ctrl+C to stop watching...\n')
    process.stdout.write('================================\n')
    try {
      runTests()
    } catch (e) {
      console.error(chalk.magenta(e.stack))
    }
  })
} else {
  runTests()
}
