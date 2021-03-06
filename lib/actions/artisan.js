/* eslint no-plusplus: 0, max-len: 0, no-shadow: 0 */

const wpCli = require('node-wp-cli');
const shelljs = require('shelljs/shell');

const Utils = require('./utils');
const Logs = require('./logs');
const Db = require('./db');

const env = require('../env');

// [TODO]
// - Improve the commit/rollback function
// - Refactor the code

function rollback(path) {
  if (path) Utils.forceUnlink([path]);
}

module.exports = {
  isInitialized(path) {
    const workingDir = Utils.getWorkingDir(path);
    const isConfigExists = Utils.isFileExists(`${workingDir}/${env.templates.config}`);

    if (isConfigExists) {
      return true;
    }
    return false;
  },

  initialize(path, config, options = null) {
    // get woring directory
    const workingDir = Utils.getWorkingDir(path);

    // show initializing message
    Logs.show('project-init', {
      type: 'Info',
      message: null,
      params: {
        docRoot: `${workingDir}`
      }
    });

    // set `wpCli` args
    const args = {};
    if (options && options.force) args.force = true;

    let serveCommand = '\twp serve'; // this will use in end of the file
    args.path = env.init.dir;

    if (path) {
      // create the working directory
      Utils.mkdirSync(path);
      args.path = `${path}/${env.init.dir}`;

      serveCommand = `\tcd ${path}\r\n\twp serve`;
    }

    // download wordpress-latest
    wpCli.call('core download', args, (err) => {
      if (err) {
        Logs.show('wordpress-fetching-failed', {
          type: 'Error',
          message: null,
          params: {}
        });

        rollback(path);
        return;
      }

      Logs.show('wordpress-fetching-success', {
        type: 'Info',
        message: null,
        params: {}
      });

      // create `site.json`
      Utils.writeFileSync(
        `${workingDir}/${env.templates.config}`,
        Utils.getTemplatePath(env.templates.config),
        config
      );

      // clean wordpress codebase
      const deleteList = env.deleteList;
      for (let i = 0; i < deleteList.length; i++) {
        deleteList[i] = deleteList[i].replace('<siteDir>', `${workingDir}/${env.init.dir}`);
      }
      Utils.forceUnlink(deleteList);

      // create `wp-config.php`
      Utils.writeFileSync(
        `${workingDir}/${env.init.dir}/${env.templates.wpConfig}`,
        Utils.getTemplatePath(env.templates.wpConfig),
        config
      );

      // create `.gitignore`
      Utils.writeFileSync(
        `${workingDir}/${env.templates.gitignore}`,
        Utils.getTemplatePath(env.templates.gitignore)
      );

      // create the databse
      Db.create(config, (err) => {
        if (err) {
          Logs.show('create-database-failed', {
            type: 'Error',
            message: null,
            params: {}
          });

        // Ready for development, yet
        // Database creation failed.
          Logs.show('project-init-success', {
            type: 'Info',
            message: null,
            params: {
              siteName: config.siteName,
              docRoot: workingDir,
              warnings: '\r\nSomething went wrong!\r\nYou need to update database settings manually.\r\n',
              command: serveCommand
            }
          });
        } else {
          Logs.show('create-database-success', {
            type: 'Info',
            message: null,
            params: {}
          });

        // Install WordPress
          if (config.doInstall) {
            const args = {
              url: config.siteUrl,
              title: config.siteName,
              admin_user: config.adminUser,
              admin_password: config.adminPwd,
              admin_email: config.adminEmail
            };

            args.path = env.init.dir;
            if (path) {
              args.path = `${path}/${env.init.dir}`;
            }

            wpCli.call('core install', args, (err, resp) => {
              if (err) {
                Logs.show('wordpress-installing-failed', {
                  type: 'Error',
                  message: null,
                  params: {
                    message: resp.message
                  }
                });
                return;
              }

              Logs.show('wordpress-installing-success', {
                type: 'Info',
                message: null,
                params: {}
              });

              // Ready for development
              // All initilizing steps are done.
              Logs.show('project-init-success', {
                type: 'Info',
                message: null,
                params: {
                  siteName: config.siteName,
                  docRoot: workingDir,
                  warnings: '',
                  command: serveCommand
                }
              });
            });
          } else {
            Logs.show('wordpress-installing-skipped', {
              type: 'Warn',
              message: null,
              params: {}
            });

            // Ready for development
            // Skipped WordPress instalaltion
            Logs.show('project-init-success', {
              type: 'Info',
              message: null,
              params: {
                siteName: config.siteName,
                docRoot: workingDir,
                warnings: '\r\nWordPress instalaltion yet to be complete.\r\nYou need to do it manually.\r\n',
                command: serveCommand
              }
            });
          }
        }
      });
    });
  },

  startServer(options) {
    // check if already initialized a project
    if (!this.isInitialized()) {
      Logs.show('working-directory-invalid', {
        type: 'Error',
        message: null,
        params: {}
      });
      return;
    }

    // Grab the configurations
    const config = JSON.parse(Utils.readFileSync(`./${env.templates.config}`, 'utf-8'));
    const portToSet = options.port || config.server.port || env.server.defaultPort;

    // If the given port is different than whats in the config, update site.json with the new port
    if (portToSet !== config.server.port) {
      config.server.port = portToSet;
      Utils.writeJSONSync(`${env.templates.config}`, config);
    }

    // Update the `siteurl` and `home` values in the wp_options table according to the new port.
    const query = `UPDATE ${config.db.mysqlDbTblPrefix}` +
    "options SET option_value = '" +
    `http://localhost:${portToSet}` +
    "' WHERE option_name = 'home' OR option_name = 'siteurl';";

    Db.queryExec(config.db, query, () => {
      const params = {
        dateStarted: new Date(),
        IpPort: `http://localhost:${portToSet}`,
        docRoot: `${Utils.getWorkingDir()}/${env.init.dir}/`
      };

      // Show startup message
      Logs.show('server-started', {
        type: 'Log',
        message: null,
        params
      });

      // [TODO]
      // Here, later we need to read the `site.json` and
      // get those server settings.
      // For that; it needs to provide at the initializing the project
      const host = `${config.server.host || env.server.host}:${portToSet}`;
      const docRoot = `${Utils.getWorkingDir()}/${env.init.dir}`;
      shelljs.exec(`php -S ${host} -t ${docRoot}`);
    });
  }
};
