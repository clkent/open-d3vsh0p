const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRemotePlist, remotePlistPath, REMOTE_LABEL } = require('./remote-plist');

describe('remote-plist', () => {
  it('places the plist in LaunchAgents under the remote label', () => {
    assert.equal(remotePlistPath('/Users/me'), `/Users/me/Library/LaunchAgents/${REMOTE_LABEL}.plist`);
  });

  it('starts remote start inside a detached tmux session at login, restarting only on failure', () => {
    const xml = buildRemotePlist({
      nodePath: '/opt/node/bin/node', tmuxPath: '/opt/homebrew/bin/tmux', logDir: '/logs',
      pathEnv: '/opt/homebrew/bin:/usr/bin', home: '/Users/me', devshopRoot: '/opt/devshop', indexJs: '/opt/devshop/index.js'
    });
    assert.match(xml, new RegExp(`<string>${REMOTE_LABEL}</string>`));
    const args = [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map(m => m[1]);
    const i = args.indexOf('/opt/homebrew/bin/tmux');
    assert.deepEqual(args.slice(i, i + 12), ['/opt/homebrew/bin/tmux', 'new-session', '-d', '-s', 'devshop-remote', '-c', '/opt/devshop', '--', '/opt/node/bin/node', '/opt/devshop/index.js', 'remote', 'start']);
    assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(xml, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.match(xml, /<string>\/logs\/launchd-stdout\.log<\/string>/);
    assert.match(xml, /<key>HOME<\/key>\s*<string>\/Users\/me<\/string>/);
  });

  it('puts node and tmux dirs first on PATH and de-duplicates', () => {
    const xml = buildRemotePlist({ nodePath: '/opt/node/bin/node', tmuxPath: '/opt/homebrew/bin/tmux', logDir: '/logs', pathEnv: '/opt/homebrew/bin:/usr/bin:/bin', home: '/h' });
    const pathValue = xml.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/)[1];
    assert.equal(pathValue, '/opt/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin');
  });

  it('escapes XML special characters in paths', () => {
    const xml = buildRemotePlist({ nodePath: '/n/node', tmuxPath: '/t/tmux', logDir: '/a&b', pathEnv: '', home: '/h' });
    assert.match(xml, /\/a&amp;b\/launchd-stdout\.log/);
  });

  it('requires tmuxPath and logDir', () => {
    assert.throws(() => buildRemotePlist({ logDir: '/l' }), /tmuxPath/);
    assert.throws(() => buildRemotePlist({ tmuxPath: '/t' }), /logDir/);
  });
});
