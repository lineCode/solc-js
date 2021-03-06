const tape = require('tape');
const semver = require('semver');
const solc = require('../index.js');
const linker = require('../linker.js');

function getBytecode (output, fileName, contractName) {
  try {
    var outputContract;
    if (semver.lt(solc.semver(), '0.4.9')) {
      outputContract = output.contracts[contractName];
    } else {
      outputContract = output.contracts[fileName + ':' + contractName];
    }
    return outputContract['bytecode'];
  } catch (e) {
    return '';
  }
}

function getBytecodeStandard (output, fileName, contractName) {
  try {
    var outputFile;
    if (semver.lt(solc.semver(), '0.4.9')) {
      outputFile = output.contracts[''];
    } else {
      outputFile = output.contracts[fileName];
    }
    return outputFile[contractName]['evm']['bytecode']['object'];
  } catch (e) {
    return '';
  }
}

tape('Version and license', function (t) {
  t.test('check version', function (st) {
    st.equal(typeof solc.version(), 'string');
    st.end();
  });
  t.test('check semver', function (st) {
    st.equal(typeof solc.semver(), 'string');
    st.end();
  });
  t.test('check license', function (st) {
    st.ok(typeof solc.license() === 'undefined' || typeof solc.license() === 'string');
    st.end();
  });
});

tape('Compilation', function (t) {
  t.test('single files can be compiled', function (st) {
    var output = solc.compile('contract x { function g() {} }');
    st.ok('contracts' in output);
    var bytecode = getBytecode(output, '', 'x');
    st.ok(bytecode);
    st.ok(bytecode.length > 0);
    st.end();
  });
  t.test('invalid source code fails properly', function (st) {
    var output = solc.compile('contract x { this is an invalid contract }');
    if (semver.lt(solc.semver(), '0.1.4')) {
      st.ok(output.error.indexOf('Parser error: Expected identifier') !== -1);
      st.end();
      return;
    }
    st.plan(3);
    st.ok('errors' in output);
    // Check if the ParserError exists, but allow others too
    st.ok(output.errors.length >= 1);
    for (var error in output.errors) {
      // Error should be something like:
      //   ParserError
      //   Error: Expected identifier
      //   Parser error: Expected identifier
      if (
        output.errors[error].indexOf('ParserError') !== -1 ||
        output.errors[error].indexOf('Error: Expected identifier') !== -1 ||
        output.errors[error].indexOf('Parser error: Expected identifier') !== -1
      ) {
        st.ok(true);
      }
    }
    st.end();
  });

  t.test('multiple files can be compiled', function (st) {
    if (semver.lt(solc.semver(), '0.1.6')) {
      st.skip('Not supported by solc <0.1.6');
      st.end();
      return;
    }

    var input = {
      'lib.sol': 'library L { function f() returns (uint) { return 7; } }',
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    var output = solc.compile({sources: input});
    var x = getBytecode(output, 'cont.sol', 'x');
    st.ok(x);
    st.ok(x.length > 0);
    var L = getBytecode(output, 'lib.sol', 'L');
    st.ok(L);
    st.ok(L.length > 0);
    st.end();
  });

  t.test('lazy-loading callback works', function (st) {
    if (semver.lt(solc.semver(), '0.2.1')) {
      st.skip('Not supported by solc <0.2.1');
      st.end();
      return;
    }

    var input = {
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    function findImports (path) {
      if (path === 'lib.sol') {
        return { contents: 'library L { function f() returns (uint) { return 7; } }' };
      } else {
        return { error: 'File not found' };
      }
    }
    var output = solc.compile({sources: input}, 0, findImports);
    var x = getBytecode(output, 'cont.sol', 'x');
    var L = getBytecode(output, 'lib.sol', 'L');
    st.ok(x);
    st.ok(x.length > 0);
    st.ok(L);
    st.ok(L.length > 0);
    st.end();
  });

  t.test('lazy-loading callback works (with file not found)', function (st) {
    if (semver.lt(solc.semver(), '0.2.1')) {
      st.skip('Not supported by solc <0.2.1');
      st.end();
      return;
    }

    var input = {
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    function findImports (path) {
      return { error: 'File not found' };
    }
    var output = solc.compile({sources: input}, 0, findImports);
    st.plan(3);
    st.ok('errors' in output);
    // Check if the ParserError exists, but allow others too
    st.ok(output.errors.length >= 1);
    for (var error in output.errors) {
      // Error should be something like:
      //   cont.sol:1:1: ParserError: Source "lib.sol" not found: File not found
      //   cont.sol:1:1: Error: Source "lib.sol" not found: File not found
      if (output.errors[error].indexOf('Error') !== -1 && output.errors[error].indexOf('File not found') !== -1) {
        st.ok(true);
      }
    }
    st.end();
  });

  t.test('lazy-loading callback works (with exception)', function (st) {
    if (semver.lt(solc.semver(), '0.2.1')) {
      st.skip('Not supported by solc <0.2.1');
      st.end();
      return;
    }

    var input = {
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    function findImports (path) {
      throw new Error('Could not implement this interface properly...');
    }
    st.throws(function () {
      solc.compile({sources: input}, 0, findImports);
    }, /^Error: Could not implement this interface properly.../);
    st.end();
  });

  t.test('lazy-loading callback fails properly (with invalid callback)', function (st) {
    if (semver.lt(solc.semver(), '0.2.1')) {
      st.skip('Not supported by solc <0.2.1');
      st.end();
      return;
    }

    var input = {
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    st.throws(function () {
      solc.compile({sources: input}, 0, "this isn't a callback");
    }, /Invalid callback specified./);
    st.end();
  });

  t.test('file import without lazy-loading callback fails properly', function (st) {
    if (semver.lt(solc.semver(), '0.2.1')) {
      st.skip('Not supported by solc <0.2.1');
      st.end();
      return;
    }

    var input = {
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    var output = solc.compile({sources: input}, 0);
    st.plan(3);
    st.ok('errors' in output);
    // Check if the ParserError exists, but allow others too
    st.ok(output.errors.length >= 1);
    for (var error in output.errors) {
      // Error should be something like:
      //   cont.sol:1:1: ParserError: Source "lib.sol" not found: File not supplied initially.
      //   cont.sol:1:1: Error: Source "lib.sol" not found: File not supplied initially.
      if (output.errors[error].indexOf('Error') !== -1 && output.errors[error].indexOf('File not supplied initially.') !== -1) {
        st.ok(true);
      }
    }
    st.end();
  });

  t.test('compiling standard JSON', function (st) {
    if (!solc.supportsStandard) {
      st.skip('Not supported by solc');
      st.end();
      return;
    }

    var input = {
      'language': 'Solidity',
      'settings': {
        'outputSelection': {
          '*': {
            '*': [ 'evm.bytecode' ]
          }
        }
      },
      'sources': {
        'lib.sol': {
          'content': 'library L { function f() returns (uint) { return 7; } }'
        },
        'cont.sol': {
          'content': 'import "lib.sol"; contract x { function g() { L.f(); } }'
        }
      }
    };

    function bytecodeExists (output, fileName, contractName) {
      try {
        return output.contracts[fileName][contractName]['evm']['bytecode']['object'].length > 0;
      } catch (e) {
        return false;
      }
    }

    var output = JSON.parse(solc.compileStandard(JSON.stringify(input)));
    st.ok(bytecodeExists(output, 'cont.sol', 'x'));
    st.ok(bytecodeExists(output, 'lib.sol', 'L'));
    st.end();
  });
  t.test('invalid source code fails properly with standard JSON', function (st) {
    if (!solc.supportsStandard) {
      st.skip('Not supported by solc');
      st.end();
      return;
    }

    var input = {
      'language': 'Solidity',
      'settings': {
        'outputSelection': {
          '*': {
            '*': [ 'evm.bytecode' ]
          }
        }
      },
      'sources': {
        'x.sol': {
          'content': 'contract x { this is an invalid contract }'
        }
      }
    };
    var output = JSON.parse(solc.compileStandard(JSON.stringify(input)));
    st.plan(3);
    st.ok('errors' in output);
    st.ok(output.errors.length >= 1);
    // Check if the ParserError exists, but allow others too
    for (var error in output.errors) {
      if (output.errors[error].type === 'ParserError') {
        st.ok(true);
      }
    }
    st.end();
  });
  t.test('compiling standard JSON (with callback)', function (st) {
    if (!solc.supportsStandard) {
      st.skip('Not supported by solc');
      st.end();
      return;
    }

    var input = {
      'language': 'Solidity',
      'settings': {
        'outputSelection': {
          '*': {
            '*': [ 'evm.bytecode' ]
          }
        }
      },
      'sources': {
        'cont.sol': {
          'content': 'import "lib.sol"; contract x { function g() { L.f(); } }'
        }
      }
    };

    function findImports (path) {
      if (path === 'lib.sol') {
        return { contents: 'library L { function f() returns (uint) { return 7; } }' };
      } else {
        return { error: 'File not found' };
      }
    }

    function bytecodeExists (output, fileName, contractName) {
      try {
        return output.contracts[fileName][contractName]['evm']['bytecode']['object'].length > 0;
      } catch (e) {
        return false;
      }
    }

    var output = JSON.parse(solc.compileStandard(JSON.stringify(input), findImports));
    st.ok(bytecodeExists(output, 'cont.sol', 'x'));
    st.ok(bytecodeExists(output, 'lib.sol', 'L'));
    st.end();
  });
  t.test('compiling standard JSON (using wrapper)', function (st) {
    // Example needs support for compileJSONMulti
    // FIXME: add test for wrapper without multiple files
    if (semver.lt(solc.semver(), '0.1.6')) {
      st.skip('Not supported by solc <0.1.6');
      st.end();
      return;
    }

    var input = {
      'language': 'Solidity',
      'settings': {
        'outputSelection': {
          '*': {
            '*': [ 'evm.bytecode' ]
          }
        }
      },
      'sources': {
        'lib.sol': {
          'content': 'library L { function f() returns (uint) { return 7; } }'
        },
        'cont.sol': {
          'content': 'import "lib.sol"; contract x { function g() { L.f(); } }'
        }
      }
    };

    var output = JSON.parse(solc.compileStandardWrapper(JSON.stringify(input)));
    var x = getBytecodeStandard(output, 'cont.sol', 'x');
    st.ok(x);
    st.ok(x.length > 0);
    var L = getBytecodeStandard(output, 'lib.sol', 'L');
    st.ok(L);
    st.ok(L.length > 0);
    st.end();
  });

  t.test('compiling standard JSON (using wrapper and libraries)', function (st) {
    // Example needs support for compileJSONMulti
    // FIXME: add test for wrapper without multiple files
    if (semver.lt(solc.semver(), '0.1.6')) {
      st.skip('Not supported by solc <0.1.6');
      st.end();
      return;
    }

    var input = {
      'language': 'Solidity',
      'settings': {
        'libraries': {
          'lib.sol': {
            'L': '0x4200000000000000000000000000000000000001'
          }
        },
        'outputSelection': {
          '*': {
            '*': [ 'evm.bytecode' ]
          }
        }
      },
      'sources': {
        'lib.sol': {
          'content': 'library L { function f() returns (uint) { return 7; } }'
        },
        'cont.sol': {
          'content': 'import "lib.sol"; contract x { function g() { L.f(); } }'
        }
      }
    };

    var output = JSON.parse(solc.compileStandardWrapper(JSON.stringify(input)));
    var x = getBytecodeStandard(output, 'cont.sol', 'x');
    st.ok(x);
    st.ok(x.length > 0);
    st.ok(Object.keys(linker.findLinkReferences(x)).length === 0);
    var L = getBytecodeStandard(output, 'lib.sol', 'L');
    st.ok(L);
    st.ok(L.length > 0);
    st.end();
  });
});

tape('Loading Legacy Versions', function (t) {
  t.test('loading remote version - development snapshot', function (st) {
    // getting the development snapshot
    st.plan(3);
    solc.loadRemoteVersion('latest', function (err, solcSnapshot) {
      st.notOk(err);
      var output = solcSnapshot.compile('contract x { function g() {} }');
      st.ok(':x' in output.contracts);
      st.ok(output.contracts[':x'].bytecode.length > 0);
    });
  });
});

tape('Linking', function (t) {
  // FIXME: all the linking tests require compileJSONMulti support,
  //        create test cases which have all files in a single source and could run with 0.1.3
  if (semver.lt(solc.semver(), '0.1.6')) {
    t.skip('Not supported by solc <0.1.6');
    t.end();
    return;
  }

  t.test('link properly', function (st) {
    var input = {
      'lib.sol': 'library L { function f() returns (uint) { return 7; } }',
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    var output = solc.compile({sources: input});
    var bytecode = getBytecode(output, 'cont.sol', 'x');
    st.ok(bytecode);
    st.ok(bytecode.length > 0);
    bytecode = solc.linkBytecode(bytecode, { 'lib.sol:L': '0x123456' });
    st.ok(bytecode.indexOf('_') < 0);
    st.end();
  });

  t.test('link properly with two-level configuration (from standard JSON)', function (st) {
    var input = {
      'lib.sol': 'library L { function f() returns (uint) { return 7; } }',
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    var output = solc.compile({sources: input});
    var bytecode = getBytecode(output, 'cont.sol', 'x');
    st.ok(bytecode);
    st.ok(bytecode.length > 0);
    bytecode = solc.linkBytecode(bytecode, { 'lib.sol': { 'L': '0x123456' } });
    st.ok(bytecode.indexOf('_') < 0);
    st.end();
  });

  t.test('linker to fail with missing library', function (st) {
    var input = {
      'lib.sol': 'library L { function f() returns (uint) { return 7; } }',
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    var output = solc.compile({sources: input});
    var bytecode = getBytecode(output, 'cont.sol', 'x');
    st.ok(bytecode);
    st.ok(bytecode.length > 0);
    bytecode = solc.linkBytecode(bytecode, { });
    st.ok(bytecode.indexOf('_') >= 0);
    st.end();
  });

  t.test('linker to fail with invalid address', function (st) {
    var input = {
      'lib.sol': 'library L { function f() returns (uint) { return 7; } }',
      'cont.sol': 'import "lib.sol"; contract x { function g() { L.f(); } }'
    };
    var output = solc.compile({sources: input});
    var bytecode = getBytecode(output, 'cont.sol', 'x');
    st.ok(bytecode);
    st.ok(bytecode.length > 0);
    st.throws(function () {
      solc.linkBytecode(bytecode, { 'lib.sol:L': '' });
    });
    st.end();
  });

  t.test('linker properly with truncated library name', function (st) {
    var input = {
      'lib.sol': 'library L1234567890123456789012345678901234567890 { function f() returns (uint) { return 7; } }',
      'cont.sol': 'import "lib.sol"; contract x { function g() { L1234567890123456789012345678901234567890.f(); } }'
    };
    var output = solc.compile({sources: input});
    var bytecode = getBytecode(output, 'cont.sol', 'x');
    st.ok(bytecode);
    st.ok(bytecode.length > 0);
    bytecode = solc.linkBytecode(bytecode, { 'lib.sol:L1234567890123456789012345678901234567890': '0x123456' });
    st.ok(bytecode.indexOf('_') < 0);
    st.end();
  });
});
