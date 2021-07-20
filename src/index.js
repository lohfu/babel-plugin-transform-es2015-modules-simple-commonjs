const template = require('@babel/template').default

const buildRequire = template(`
  require(SOURCE);
`)

const buildRequireDefault = template(`
  require(SOURCE).default;
`)

const buildExportsAssignment = template(`
  module.exports = EXPORT;
`)

const buildNamedExportsAssignment = template(`
  exports.NAME = EXPORT;
`)

const buildExportAll = template(`
  for(var NAME in EXPORTS) {
    if (NAME !== "default") {
      exports[NAME] = EXPORTS[NAME];
    }
  }
`)

module.exports = function ({ types: t }) {
  return {
    inherits: require('@babel/plugin-transform-strict-mode').default,
    visitor: {
      Program: {
        exit(path) {
          const sources = []
          const anonymousSources = []
          const { scope } = path

          let hasDefaultExport = false
          let hasNamedExports = false
          let lastExportPath = null

          // rename these commonjs variables if they're declared in the file
          scope.rename('module')
          scope.rename('exports')
          scope.rename('require')

          const body = path.get('body')

          function addSource(path) {
            const importedID = path.scope.generateUidIdentifier(path.node.source.value)

            sources.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(importedID, buildRequire({ SOURCE: path.node.source }).expression),
              ]),
            )

            return importedID
          }

          for (const path of body) {
            if (path.isExportDefaultDeclaration()) {
              hasDefaultExport = true
              lastExportPath = path
              const declaration = path.get('declaration')
              if (declaration.type === 'FunctionDeclaration') {
                if (declaration.node.id) {
                  path.replaceWithMultiple([declaration.node, buildExportsAssignment({ EXPORT: declaration.node.id })])
                } else {
                  path.replaceWith(buildExportsAssignment({ EXPORT: t.toExpression(declaration.node) }))
                }
              } else {
                path.replaceWith(buildExportsAssignment({ EXPORT: t.toExpression(declaration.node) }))
              }
              continue
            }

            if (path.isImportDeclaration()) {
              const specifiers = path.node.specifiers
              const is2015Compatible = path.node.source.value.match(/@babel\/runtime[\\/]/)
              if (specifiers.length === 0) {
                anonymousSources.push(buildRequire({ SOURCE: path.node.source }))
              } else if (specifiers.length === 1 && specifiers[0].type === 'ImportDefaultSpecifier') {
                const template = is2015Compatible ? buildRequireDefault : buildRequire
                sources.push(
                  t.variableDeclaration('var', [
                    t.variableDeclarator(
                      t.identifier(specifiers[0].local.name),
                      template({ SOURCE: path.node.source }).expression,
                    ),
                  ]),
                )
              } else {
                const importedID = addSource(path)

                specifiers.forEach(({ imported, local }) => {
                  if (!imported || (!is2015Compatible && imported.name === 'default')) {
                    sources.push(
                      t.variableDeclaration('var', [
                        t.variableDeclarator(t.identifier(local.name), t.identifier(importedID.name)),
                      ]),
                    )
                  } else {
                    sources.push(
                      t.variableDeclaration('var', [
                        t.variableDeclarator(
                          t.identifier(local.name),
                          t.identifier(importedID.name + '.' + imported.name),
                        ),
                      ]),
                    )
                  }
                })
              }

              path.remove()
              continue
            }

            if (path.isExportNamedDeclaration()) {
              lastExportPath = path
              const declaration = path.get('declaration')

              // if we are exporting a class/function/variable
              if (declaration.node) {
                hasNamedExports = true
                if (declaration.isFunctionDeclaration()) {
                  const id = declaration.node.id
                  path.replaceWithMultiple([declaration.node, buildNamedExportsAssignment({ NAME: id, EXPORT: id })])
                } else if (declaration.isClassDeclaration()) {
                  const id = declaration.node.id
                  path.replaceWithMultiple([declaration.node, buildNamedExportsAssignment({ NAME: id, EXPORT: id })])
                } else if (declaration.isVariableDeclaration()) {
                  const declarators = declaration.get('declarations')
                  for (const decl of declarators) {
                    const id = decl.get('id')

                    const init = decl.get('init')
                    if (!init.node) {
                      init.replaceWith(t.identifier('undefined'))
                    }

                    if (id.isIdentifier()) {
                      init.replaceWith(buildNamedExportsAssignment({ NAME: id.node, EXPORT: init.node }).expression)
                    }
                  }
                  path.replaceWith(declaration.node)
                }
                continue
              }

              // if we are exporting already instantiated variables
              const specifiers = path.get('specifiers')
              if (specifiers.length) {
                const nodes = []
                const source = path.node.source
                let importedID
                if (source) {
                  // export a from 'b';
                  // 'b' is the source
                  importedID = addSource(path)
                }

                for (const specifier of specifiers) {
                  if (specifier.isExportSpecifier()) {
                    let local = specifier.node.local

                    // if exporting from we need to modify the local lookup
                    if (importedID) {
                      if (local.name === 'default') {
                        local = importedID
                      } else {
                        local = t.memberExpression(importedID, local)
                      }
                    }

                    // if exporting to default, its module.exports
                    if (specifier.node.exported.name === 'default') {
                      hasDefaultExport = true
                      nodes.push(buildExportsAssignment({ EXPORT: local }))
                    } else {
                      hasNamedExports = true
                      nodes.push(buildNamedExportsAssignment({ NAME: specifier.node.exported, EXPORT: local }))
                    }
                  }
                }

                path.replaceWithMultiple(nodes)
              }
              continue
            }

            if (path.isExportAllDeclaration()) {
              // export * from 'a';
              const importedID = addSource(path)
              const keyName = path.scope.generateUidIdentifier(importedID.name + '_key')

              path.replaceWithMultiple(buildExportAll({ EXPORTS: importedID, NAME: keyName }))
            }
          }

          if (hasNamedExports && hasDefaultExport) {
            throw lastExportPath.buildCodeFrameError(
              'The simple-commonjs plugin does not support both a export default and a export named in the same file. This is because the module.exports would override any export',
            )
          }

          path.unshiftContainer('body', sources.concat(anonymousSources))
        },
      },
    },
  }
}
