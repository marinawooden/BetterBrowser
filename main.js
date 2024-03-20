const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
} = require("electron");

const path = require("path");
const env = process.env.NODE_ENV || "production";
const OFFSET = 30;
const os = require("os");

const sqlite3 = require("sqlite3");
const sqlite = require("sqlite");

const Store = require("electron-store");
const store = new Store();

const fsasync = require("fs").promises;
const fs = require("fs");
const { parse } = require("csv-parse");
const { finished } = require("stream/promises");

let db;
let currentDBPath;
let win;
let tableCreator;
let tableEditor;
let editingTable;
let csvUpload;
let csvPath;
let hasUnsavedChanges = false;

// check if the app is running as a Squirrel.windows command
// if (sqrl) {
//   app.quit();
// }

// this should be placed at top of main.js to handle setup events quickly
if (handleSquirrelEvent()) {
  // squirrel event handled and app will exit in 1000ms, so don't do anything else
  return;
}

function handleSquirrelEvent() {
  if (process.argv.length === 1) {
    return false;
  }

  const ChildProcess = require("child_process");
  const path = require("path");

  const appFolder = path.resolve(process.execPath, "..");
  const rootAtomFolder = path.resolve(appFolder, "..");
  const updateDotExe = path.resolve(path.join(rootAtomFolder, "Update.exe"));
  const exeName = path.basename(process.execPath);

  const spawn = function (command, args) {
    let spawnedProcess, error;

    try {
      spawnedProcess = ChildProcess.spawn(command, args, { detached: true });
    } catch (error) {}

    return spawnedProcess;
  };

  const spawnUpdate = function (args) {
    return spawn(updateDotExe, args);
  };

  const squirrelEvent = process.argv[1];
  switch (squirrelEvent) {
    case "--squirrel-install":
    case "--squirrel-updated":
      // Optionally do things such as:
      // - Add your .exe to the PATH
      // - Write to the registry for things like file associations and
      //   explorer context menus

      // Install desktop and start menu shortcuts
      spawnUpdate(["--createShortcut", exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case "--squirrel-uninstall":
      // Undo anything you did in the --squirrel-install and
      // --squirrel-updated handlers

      // Remove desktop and start menu shortcuts
      spawnUpdate(["--removeShortcut", exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case "--squirrel-obsolete":
      // This is called on the outgoing version of your app before
      // we update to the new version - it's the opposite of
      // --squirrel-updated

      app.quit();
      return true;
  }
}

const openTableCreator = () => {
  tableCreator = new BrowserWindow({
    width: 600,
    height: 600,
    icon: "/public/icons/Icon.jpg",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  tableCreator.setMenu(null);

  tableCreator.loadFile("public/tablecreator.html");
  // tableCreator.webContents.openDevTools();
};

const openCSVEditor = () => {
  csvUpload = new BrowserWindow({
    icon: "/public/icons/Icon.jpg",
    width: 600,
    height: 450,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  csvUpload.setMenu(null);
  csvUpload.loadFile("public/uploadcsv.html");
};

const openTableEditor = () => {
  tableEditor = new BrowserWindow({
    icon: "/public/icons/Icon.jpg",
    width: 600,
    height: 450,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  tableEditor.setMenu(null);

  tableEditor.on("closed", () => {
    tableEditor = null;
  });

  tableEditor.loadFile("public/tableeditor.html");
};

async function processCSVFile(delimiter = ",", firstRowIsColumns) {
  const records = [];
  const parser = fs.createReadStream(csvPath).pipe(
    parse({
      delimiter: delimiter, // Change this to the delimiter used in your CSV file
      columns: firstRowIsColumns, // Set this to true if your CSV file has headers
    }),
  );

  parser.on("readable", function () {
    let record;
    while ((record = parser.read()) !== null) {
      // Work with each record
      records.push(record);
    }
  });
  await finished(parser);
  return records;
}

ipcMain.handle("change-theme-preference", async () => {
  let prefersDarkMode = await store.get("prefers-dark");
  if (prefersDarkMode !== undefined) {
    console.log(prefersDarkMode);
    await store.set("prefers-dark", !prefersDarkMode);
  }

  return prefersDarkMode ? "dark" : "light";
});

ipcMain.handle("get-theme-preference", getPrefersDark);

ipcMain.handle("add-new-rows", async (event, ...args) => {
  try {
    console.log("HERE!");

    let viewingTable = args[0];
    let columnValues = args[1];
    let columnNames = args[2];

    if (
      !previewDB?.conn ||
      !db ||
      !viewingTable ||
      !columnNames ||
      !columnValues
    ) {
      throw new Error("Missing required arguments!");
    }

    let placeholderString = `(${columnNames.map(() => "?")})`;
    let query = `INSERT INTO ${viewingTable} (${formatColumns(columnNames)}) VALUES ${columnValues.map(() => placeholderString)}`;

    await previewDB.conn.exec("BEGIN TRANSACTION;\n");
    await previewDB.conn.run(query, columnValues.flat(1));
    await previewDB.conn.exec("COMMIT;");

    return {
      type: "success",
    };
  } catch (err) {
    await previewDB.conn.exec("ROLLBACK;");

    return {
      type: "err",
      detail: err.code,
      error: err,
    };
  }
});

ipcMain.handle("get-fk-violations", async (event, ...args) => {
  try {
    if (!args[0]) {
      throw new Error("Please provide a table!");
    }

    let violations = await previewDB.conn.all("PRAGMA foreign_key_check");
    let foreignKeyNames = await previewDB.conn.all(
      `PRAGMA foreign_key_list('${args[0]}')`,
    );

    return {
      type: "success",
      violations: violations
        .map((viol) => {
          return {
            ...viol,
            col: foreignKeyNames.find(
              (elem) => elem.id === viol.fkid && elem.table === viol.parent,
            )?.from,
          };
        })
        .filter((elem) => elem.table === args[0]),
    };
  } catch (err) {
    return {
      type: "err",
      error: err,
    };
  }
});

/**
 * Updates the staging database
 */
ipcMain.handle("add-dataview-changes", async (event, ...args) => {
  try {
    let table = args[0];
    let modifiedColumn = args[1];
    let value = args[2];
    let pk = args[3];
    let pkValue = args[4];

    if (!table || !modifiedColumn || !value || !pk || !db || !previewDB.conn) {
      throw new Error("Missing required arguments!");
    }

    await previewDB.conn.exec(`BEGIN TRANSACTION;`);
    await previewDB.conn.run(
      `UPDATE \`${table}\` SET \`${modifiedColumn}\` = ? WHERE \`${pk}\` = ?;`,
      value,
      pkValue,
    );
    let violations = await previewDB.conn.all("PRAGMA foreign_key_check");

    if (violations.length > 0) {
      throw new Error("fk");
    }

    await previewDB.conn.exec(`COMMIT;`);
    hasUnsavedChanges = true;

    return {
      type: "success",
    };
  } catch (err) {
    if (err.message === "fk") {
      let violations = await previewDB.conn.all("PRAGMA foreign_key_check");
      let foreignKeys = await previewDB.conn.all(
        `PRAGMA foreign_key_list('${args[0]}')`,
      );

      violations = violations.map((violation) => {
        return {
          ...violation,
          from: foreignKeys.find((tbl) => tbl.table === violation.parent)?.[
            "from"
          ],
        };
      });

      //
      await previewDB.conn.exec(`COMMIT;`);

      return {
        type: "err",
        error: err,
        detail: "FOREIGN_KEY",
        violations: violations,
      };
    } else if (
      /cannot start/g.test(err.message) ||
      /cannot commit/g.test(err.message)
    ) {
      return {
        type: "err",
        detail: err.code,
        error: "too fast",
      };
    } else if (/Missing required arguments!/g.test(err.message)) {
      return {
        type: "err",
        error: err.message,
      };
    } else {
      await previewDB.conn.exec("ROLLBACK;");
      const ERRORCODES = {
        UNIQUE: /UNIQUE/gim,
        TYPE_MISMATCH: /Type Mismatch/gim,
      };

      const errorObj = {
        type: "err",
        error: err,
      };

      Object.keys(ERRORCODES).forEach((obj) => {
        if (ERRORCODES[obj].test(err.message)) {
          errorObj.detail = obj;
        }
      });

      if (!errorObj.detail) {
        errorObj.detail === "UNKNOWN";
      }

      return errorObj;
    }
  }
});

/** Updates the 'real' table to hold all the changes that have been made */
ipcMain.handle("commit-dataview-changes", async (event, ...args) => {
  try {
    let changedTable = args[0];

    if (!changedTable || !currentDBPath || !previewDB.location) {
      throw new Error("Missing necessary input");
    }

    let fkviolations = await previewDB.conn.all("PRAGMA foreign_key_check;");
    //
    if (fkviolations.length > 0) {
      throw new Error("Please resolve all foreign key conflicts!");
    }

    // just copy file
    await fsasync.copyFile(previewDB.location, currentDBPath);
    await db.close();
    db = await getDBConnection(currentDBPath);

    // TODO: Change table names

    hasUnsavedChanges = false;

    return {
      type: "success",
    };
  } catch (err) {
    console.error(err);
    return {
      type: "err",
      error: err,
    };
  }
});

/**
 * Gets information about all other columns, aside from ones in
 * the given table
 */
ipcMain.handle("get-other-columns", async (event, ...args) => {
  try {
    if (!db) {
      throw new Error("No database or currently open table was given");
    }

    let saufCurrent = args[0] || !editingTable;
    let ans = {};
    let query = `SELECT tbl_name FROM sqlite_master WHERE tbl_name NOT LIKE "sqlite_sequence"${saufCurrent ? ` AND tbl_name NOT LIKE "${editingTable}"` : ``}`;

    let tblnames = (await db.all(query)).map((tbl) => tbl.tbl_name);

    for (const tbl of tblnames) {
      let colnames = (await db.all(`PRAGMA table_info("${tbl}")`)).map(
        (col) => col.name,
      );
      ans[tbl] = colnames;
    }

    return {
      type: "success",
      results: ans,
    };
  } catch (err) {
    console.error(err);
    return {
      type: "err",
      error: err,
    };
  }
});

/** Finds the primary keys of all rows given some constraints */
ipcMain.handle("select-all-rows", async (event, ...args) => {
  try {
    let table = args[0];
    let colnames = args[1];
    let searchterm = args[2];

    if (!table || !colnames) {
      throw new Error("Missing required arguments");
    }

    let query = `SELECT * FROM ${table}`;
    if (searchterm) {
      query += " WHERE \n";

      colnames.forEach((colname, i) => {
        query += `\`${colname}\` LIKE "%${searchterm}%"${i === colnames.length - 1 ? "" : " OR\n"}`;
      });
    }
    let results = await db.all(query);

    return {
      type: "success",
      matches: results,
    };
  } catch (err) {
    return {
      type: "err",
      error: err,
    };
  }
});

/** Removes a connection from the list of recent connections */
ipcMain.handle("remove-connection", async (event, ...args) => {
  try {
    let pathToRemove = args[0];

    if (!pathToRemove) {
      throw new Error("Missing required arguments");
    }

    // if (pathToRemove === currentDBPath && db) {
    //   await db?.close();
    //   db = null;
    // }

    const recentconnections = await store.get("recent-db");
    const index = recentconnections.indexOf(pathToRemove);
    if (index > -1) {
      // only splice array when item is found
      recentconnections.splice(index, 1); // 2nd parameter means remove one item only
    }

    await store.set("recent-db", recentconnections);

    return {
      type: "success",
    };
  } catch (err) {
    return {
      type: "err",
      error: err,
    };
  }
});

/** Searches all rows in a table that match a given query */
ipcMain.handle("search-table", async (event, ...args) => {
  try {
    if (!db || !previewDB.conn) {
      throw new Error("No database is open!");
    }

    let tablename = args[0];
    let columns = args[1];
    let searchquery = args[2];
    let page = args[3] || 0;
    let sortedCol = args[4];
    let sortedOrd = args[5];

    if (tablename && columns) {
      let sqlquery = `SELECT * FROM \`${tablename}\` WHERE `;

      columns.forEach((colname, i) => {
        sqlquery += `\`${colname}\` LIKE "%${searchquery}%"${i === columns.length - 1 ? "" : " OR\n"}`;
      });

      if (sortedCol) {
        sqlquery += `ORDER BY \`${sortedCol}\` ${sortedOrd}\n`;
      }

      sqlquery += `LIMIT ${page * OFFSET}, ${OFFSET}`;

      let res = await previewDB.conn.all(sqlquery);

      return {
        type: "success",
        results: res,
      };
    } else {
      throw new Error("Missing required arguments");
    }
  } catch (err) {
    return {
      type: "err",
      error: err,
    };
  }
});

/** Closes the connection to the currently opened database, if there is one */
ipcMain.handle("close-db-connection", async (event, ...args) => {
  try {
    if (!db) {
      throw new Error("No database currently open!");
    }

    await db.close();
    db = null;

    return {
      type: "success",
    };
  } catch (err) {
    return {
      type: "error",
      error: err,
    };
  }
});

ipcMain.handle("create-from-csv", async (event, ...args) => {
  try {
    if (!csvPath) {
      throw new Error("No filepath was specified");
    }

    // let query = "BEGIN TRANSACTION;\n";
    await previewDB.conn.exec("BEGIN TRANSACTION;");
    await db.exec("BEGIN TRANSACTION;");

    const records = await processCSVFile(args[1], args[2]);
    let colNames = args[2] ? Object.keys(records[0]) : args[3];

    colNames = colNames.map((col, i) => {
      let value = records[1][Object.keys(records[0])[i]];
      return {
        name: col,
        type: /^[0-9]+$/.test(value)
          ? "INTEGER"
          : /^[0-9]*\.[0-9]+$/.test(value)
            ? "REAL"
            : /^[A-Za-z\-\(\)\+\-\*\&\#\@!+\/\\,.]+$/.test(value)
              ? "TEXT"
              : "BLOB",
      };
    });

    const creationStmt = colNames.map((e) => {
      return `\n"${e.name}" ${e.type}`;
    });

    creationStmt.push(`\nPRIMARY KEY("${args[4]}")`);

    let query = `\nCREATE TABLE "${args[0]}" (${creationStmt.toString()}\n);`;

    let insertStatements = records.map((row) => {
      return `\nINSERT INTO "${args[0]}" (${colNames.map((e) => e.name).toString()}) VALUES (${formatColumns(Object.values(row), '"')})`;
    });

    query += insertStatements.join(";");

    await previewDB.conn.exec(query);
    await db.exec(query);
    await previewDB.conn.exec("COMMIT;");
    await db.exec("COMMIT;");

    win.webContents.send("table-added");

    // win.webContents.send("edits-complete");
    csvUpload.close();

    return {
      type: "success",
    };
  } catch (err) {
    console.error(err);
    await previewDB.conn.exec("ROLLBACK;");
    await db.exec("ROLLBACK;");

    return {
      type: "err",
      err: err,
    };
  }
});

ipcMain.handle("get-csv-data", async (event, ...args) => {
  try {
    if (!csvPath) {
      throw new Error("No filepath was specified");
    }

    const records = await processCSVFile(args[0], args[1]);

    return {
      type: "success",
      content: records.slice(0, 10),
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

ipcMain.handle("csv-select", async (event, ...args) => {
  try {
    let pathSelect = await openCSVDialog();

    if (!pathSelect || pathSelect["canceled"]) {
      return {
        type: "passive",
      };
    }

    csvPath = pathSelect["filePaths"][0];
    await openCSVEditor();

    return {
      type: "success",
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

ipcMain.handle("get-foreign-keys", async (event, ...args) => {
  try {
    if (!editingTable || !db) {
      throw new Error("No table or database currently open!");
    }

    let query = `SELECT sql FROM sqlite_master WHERE type="table" and name=?`;

    let sql = await db.get(query, editingTable);
    console.log(sql["sql"].split("\n"));

    let foreignKeys = {};
    sql["sql"]
      .split("\n")
      .filter((sentence) => {
        return /^FOREIGN KEY/g.test(sentence.trim());
      })
      .forEach((fk) => {
        let colInTable = fk.match(/(?<=FOREIGN KEY\(")[^")]*/g);
        let table = fk.match(/(?<=REFERENCES ").*(?="\()/g);
        let foreignCol = fk.match(/(?<=\(")[^"]*(?="\),$)/gm);

        foreignKeys[colInTable] = `${table}.${foreignCol}`;
      });

    return {
      type: "success",
      results: foreignKeys,
    };
  } catch (err) {
    return {
      type: "err",
      error: err,
    };
  }
});

/**
 * Retrieves constraints for a table
 */
ipcMain.handle("get-constraints", async () => {
  try {
    if (!editingTable || !db) {
      throw new Error("No table or database currently open!");
    }

    let cols = await db.all(`PRAGMA table_info(\`${editingTable}\`)`);
    let createStmt = await db.get(
      `SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type = 'table'`,
      editingTable,
    );

    cols = cols.map((col) => {
      let replace = `${col.name}.*UNIQUE`;
      return {
        nn: col.notnull,
        default: col.dflt_value,
        u: new RegExp(replace, "mg").test(createStmt.sql),
      };
    });

    return {
      type: "success",
      results: cols,
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

/**
 * Deletes a column from an existing table
 */
ipcMain.handle("delete-col", async (event, ...args) => {
  try {
    if (!db || !editingTable) {
      throw new Error("No table or database open");
    }

    if (!args[0]) {
      throw new Error("Please specify a column to remove!");
    }

    let coltodrop = args[0];
    let query = `ALTER TABLE \`${editingTable}\` DROP COLUMN \`${coltodrop.match(/(?<=").*(?=")/)}\`;`;

    await db.exec(query);
    await previewDB.conn.exec(query);

    win.webContents.send("edits-complete");

    return {
      type: "success",
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

/**
 * Updates an existing table in the database (copies data and replaces)
 */
ipcMain.handle("update-table", async (event, ...args) => {
  try {
    if (!db || !editingTable) {
      throw new Error("No table or database open");
    }
    if (!args[0] || !args[1]) {
      throw new Error("Missing required parameters!");
    }

    let creationStmt = args[0];
    let newName = args[1];
    let newColNames = args[2];
    let defaults = args[3].reverse();

    if (!creationStmt || !newName || !newColNames || !defaults) {
      throw new Error("Missing required arguments");
    }

    let ogColumns = await db.all(
      `SELECT name FROM pragma_table_info("${editingTable}")`,
    );

    if (newColNames.length < ogColumns.length) {
      // columns have been removed
      ogColumns = ogColumns.filter((col) => {
        return newColNames.includes(`"${col.name}"`);
      });
    }

    ogColumns = ogColumns.map((col, i) => {
      return defaults[i]
        ? `COALESCE(\`${col.name}\`, "${defaults[i].replace(/'/g, "''")}")`
        : `\`${col.name}\``;
    });

    for (let i = 0; i < newColNames.length - ogColumns.length; i++) {
      console.log(defaults[i + ogColumns.length]);
      ogColumns.push(
        defaults[i + ogColumns.length]
          ? `CAST("${defaults[i + ogColumns.length]}" AS TEXT)`
          : "NULL",
      );
    }

    ogColumns = ogColumns.reverse();

    //
    await db.exec("BEGIN TRANSACTION;");
    await previewDB.conn.exec("BEGIN TRANSACTION;");
    let tmpname = `"${Date.now()}"`;

    let query = `\nCREATE TABLE ${tmpname} (\n${creationStmt}\n);`;
    query += `\nINSERT INTO ${tmpname} (${newColNames}) SELECT ${ogColumns.reverse()} FROM \`${editingTable}\`;`;
    query += `\nDROP TABLE "${editingTable}";`;
    query += `\nALTER TABLE ${tmpname} RENAME TO \`${newName}\`;`;
    query += `\nCOMMIT;`;

    await db.exec(query);
    await previewDB.conn.exec(query);

    editingTable = newName;
    win.webContents.send("edits-complete");

    return {
      type: "success",
    };
  } catch (err) {
    await db.exec("ROLLBACK;");
    await previewDB.conn.exec("ROLLBACK;");
    //
    //
    return {
      type: "err",
      err: err,
    };
  }
});

/**
 * Puts doublesquotes around each column in a list of column names
 * @param {Array} colnames - names of columns
 * @returns String of quotes comma-separated column names
 */
function formatColumns(colnames, separator = '"') {
  ans = "";
  colnames.forEach((name, i) => {
    let betterName = name.replace(new RegExp(separator, "g"), "");
    ans += `${separator}${betterName}${i + 1 < colnames.length ? `${separator}, ` : separator}`;
  });

  return ans;
}

/**
 * Opens the table editor, stores the current table name
 * in the main handler
 */
ipcMain.handle("open-editor", async (event, ...args) => {
  try {
    if (tableEditor) {
      tableEditor.close();
    }

    if (!db) {
      // can't technically be reached but just to be safe
      throw new Error("There's no database currently open!");
    }

    if (!args[0]) {
      throw new Error("Please provide a table to edit");
    }

    editingTable = args[0];
    openTableEditor();

    return {
      type: "success",
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

// Handles deleting a table from the currently open database,
// given a table name
ipcMain.handle("delete-table", async (event, ...args) => {
  try {
    // open up confirmation tab
    let tablename = args[0];

    if (!db) {
      throw new Error("There's no database currently open");
    }

    if (!tablename) {
      throw new Error("Please provide a table name");
    }

    let query = `DROP TABLE IF EXISTS "${tablename}"`;
    await db.exec(query);
    await previewDB.conn.exec(query);

    return {
      type: "success",
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

/**
 * Updates a sqlite table
 */
ipcMain.handle("save-changes", async (event, ...args) => {
  try {
    console.log("ENTER");
    let table = args[0];
    let columns = args[1];
    let pk = args[2];
    let newValues = args[3];
    let modifiedRows = args[4];

    if (!db || !previewDB.conn) {
      throw new Error("No database currently open!");
    }

    if (!table || !columns || !pk) {
      throw new Error("Missing required parameters.");
    }

    qry = "\nBEGIN TRANSACTION;";

    if (newValues?.length > 0) {
      for (const arr of newValues) {
        // bleh.  Need to find out how to use placeholders
        qry += `\nINSERT INTO \`${table}\` (${formatColumns(columns)}) VALUES (${formatColumns(arr)});`;
        // await db.run(qry, arr);
      }
    }

    for (let i = 0; i < modifiedRows.length; i++) {
      let j = 0;
      for (let column of columns) {
        qry += `\nUPDATE "${table}" SET "${column}" = "${modifiedRows[i].values[j]}" WHERE "${pk}" = "${modifiedRows[i].pk}";`;
        // await db.run(qry, modifiedRows[i].values[j], modifiedRows[i].pk);
        j++;
      }
    }

    await previewDB.conn.exec(qry);
    await previewDB.conn.exec("COMMIT;");

    win.webContents.send("edits-complete");

    return {
      type: "success",
    };
  } catch (err) {
    console.error(err);
    await db.exec("ROLLBACK;");
    await previewDB.conn.exec("ROLLBACK;");

    return {
      type: "err",
      err: err,
    };
  }
});

ipcMain.handle("increment-lastid", async (event, ...args) => {
  try {
    let newId = args[0];
    let table = args[1];

    if (!db) {
      throw new Error("No database currently open!");
    }

    if (!newId) {
      throw new Error("No lastid found.");
    }

    if (!table) {
      throw new Error("No table found.");
    }
    let test = await previewDB.conn.get(
      "SELECT * FROM sqlite_sequence WHERE name = ?",
      table,
    );
    if (test) {
      await previewDB.conn.run(
        "UPDATE sqlite_sequence SET seq = ? WHERE name = ?",
        newId,
        table,
      );
    }

    return {
      type: "success",
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

ipcMain.handle("add-empty-row", async (event, ...args) => {
  try {
    if (!db || !previewDB.conn || !args[0]) {
      throw new Error("Missing required arguments!");
    }

    let table = args[0];

    const DEFAULTS = {
      INTEGER: 1,
      REAL: 1.0,
      TEXT: "-",
      BLOB: "-",
    };

    let isAutoincrement = await db.get(
      "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ? AND sql LIKE '%AUTOINCREMENT%'",
      table,
    );

    await previewDB.conn.exec("BEGIN TRANSACTION;");

    const remove_key = Date.now();

    let colNames = [];
    let defValues = await Promise.all(
      (await previewDB.conn.all(`PRAGMA table_info(\`${table}\`)`)).map(
        async (col) => {
          // don't store the primary key col name if it's autoincrement, and remove it later on
          if (col.pk === 1 && isAutoincrement) {
            return remove_key;
          }

          
          colNames.push(col.name);
          return col.dflt_value
            ? col.dflt_value.replace(/"/g, "")
            : col.notnull === 1
            ? DEFAULTS[col.type] : null
        },
      ),
    );

    defValues = defValues.filter((dV) => dV !== remove_key);

    console.log(defValues);

    let tableInfo = await previewDB.conn.all(`PRAGMA table_info(\`${table}\`)`);
    let pk = tableInfo.find((col) => col.pk === 1).name;

    console.log(
      `INSERT INTO ${table} (${formatColumns(colNames)}) VALUES (${defValues});`,
    );

    console.log(defValues);

    // console.log(await previewDB.conn.all(`PRAGMA table_info(\`${table}\`)`))
    // console.log(defValues.map((v) => typeof v));

    let res = await previewDB.conn.run(
      `INSERT INTO \`${table}\` (${formatColumns(colNames)}) VALUES (${defValues})`,
    );

    console.log(
      await previewDB.conn.all(`SELECT * FROM \`${table}\` LIMIT 1 OFFSET ?;`),
    );

    let lastRecord = await previewDB.conn.get(
      `SELECT * FROM \`${table}\` LIMIT 1 OFFSET ?;`,
      res.lastID - 1,
    );

    await previewDB.conn.exec("COMMIT;");

    // get foreign key conflicts
    let violations = await previewDB.conn.all("PRAGMA foreign_key_check");
    let foreignKeyNames = await previewDB.conn.all(
      `PRAGMA foreign_key_list(\`${table}\`)`,
    );

    let conflicts = violations
      .map((viol) => {
        return {
          ...viol,
          col: foreignKeyNames.find(
            (elem) => elem.id === viol.fkid && elem.table === viol.parent,
          )?.from,
        };
      })
      .filter((elem) => elem.table === table && elem.rowid === res.lastID);
    // let conflicts = getForeignKeyViolations(table);

    return {
      type: "success",
      result: lastRecord,
      pk: pk,
      fkconflicts: conflicts,
    };
  } catch (err) {
    console.log(err);
    await previewDB.conn.exec("ROLLBACK;");
    return {
      type: "err",
      error: err,
    };
  }
});

// DEPRECATED
ipcMain.handle("new-row-meta", async (event, ...args) => {
  try {
    let table = args[0] || editingTable;

    // pk
    // isAutoincrement
    // columnNames
    // lastid

    if (!db) {
      throw new Error("No database currently open!");
    }

    if (!table) {
      throw new Error("Couldn't find a table");
    }

    let isAutoincrement = await db.get(
      "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ? AND sql LIKE '%AUTOINCREMENT%'",
      table,
    );
    let columns = await db.all(`PRAGMA table_info("${table}")`);
    let pk = columns.find((col) => col.pk === 1);

    let sql = await db.get(
      "SELECT sql FROM sqlite_master WHERE name = ?",
      table,
    );
    let keys = sql.sql.match(/(?<=^").*(?=".*DEFAULT.*\n)/gm);
    let values = sql.sql.match(/(?<=DEFAULT ").*(?=")/g);

    let def = keys?.reduce((result, key, index) => {
      result[key] = values[index];
      return result;
    }, {});

    let lastid;

    if (isAutoincrement) {
      lastid = await db.get(
        "SELECT seq FROM sqlite_sequence WHERE name = ?",
        table,
      );
    }

    return {
      pk: pk.name,
      columns: columns.map((col) => col.name),
      defaults: def,
      types: columns.map((col) => col.type),
      isAutoincrement: !!isAutoincrement,
      lastID: lastid ? lastid.seq : 0,
    };
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

ipcMain.handle("remove-rows", async (event, ...args) => {
  try {
    let rows = args[0];
    let table = args[1];

    if (!db || !previewDB.conn) {
      throw new Error("There's no database currently open!");
    }

    if (!table) {
      throw new Error("Please provide a table to delete from.");
    }

    if (rows.length > 0) {
      // TODO: Yikes
      // Also, I feel like we can do `pk` by modifying `getPk`.  Don't want to rewrite rn though
      let columns = await db.all(`PRAGMA table_info("${table}")`);
      let pk = columns.find((col) => col.pk === 1);

      let query = `DELETE FROM "${table}" WHERE "${pk["name"]}" in (${formatColumns(rows)})`;
      let start = Date.now();
      let meta = await previewDB.conn.run(query);

      return {
        changes: meta.changes || 0,
        duration: Date.now - start,
      };
    }
  } catch (err) {
    return {
      type: "error",
      err: err,
    };
  }
});

ipcMain.handle("get-table-meta", async (event, ...args) => {
  try {
    if (db && previewDB.conn) {
      tblname = args[0] || editingTable;

      if (!tblname) {
        throw new Error("Please provide a table name!");
      }

      let getCreateStmt =
        "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ?";
      let isAutoincrementStmt =
        "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ? AND sql LIKE '%AUTOINCREMENT%'";
      let results = await previewDB.conn.get(getCreateStmt, tblname);

      if (results) {
        // TODO: Fun- sql injection potentially
        let getPk = 'PRAGMA table_info("' + tblname + '")';
        let columns = await previewDB.conn.all(getPk);
        let pk = columns.find((col) => col.pk === 1);
        let isAutoincrement = await previewDB.conn.get(
          isAutoincrementStmt,
          tblname,
        );

        return {
          name: tblname,
          sql: results.sql,
          pk: pk?.name,
          isAutoincrement: !!isAutoincrement,
        };
      } else {
        throw new Error("That table doesn't exist!");
      }
    } else {
      throw new Error("No database currently open!");
    }
  } catch (err) {
    console.error(err);
    return {
      type: "err",
      error: err,
    };
  }
});

ipcMain.handle("execute-sql", async (event, ...args) => {
  let sql = args[0];

  if (previewDB.conn) {
    try {
      if (!sql) {
        throw new Error("Please specify a sql query!");
      } else {
        let startTime = Date.now();
        let res;
        if (isSelectQuery(sql)) {
          res = await previewDB.conn.all(sql);
        } else {
          res = await previewDB.conn.run(sql);
        }
        return {
          type: "success",
          data: res.length ? res : null,
          details: {
            time: Date.now() - startTime,
            numRows: res.length,
            changes: res.changes || 0,
            lastID: res.lastID,
          },
        };
      }
    } catch (err) {
      return {
        type: "error",
        err: err,
      };
    }
  } else {
    return {
      type: "error",
      err: "There's no database currently open!",
    };
  }
});

ipcMain.handle("view-data", async (event, ...args) => {
  try {
    let table = args[0];
    let page = args[1] || 0;
    let orderBy = args[2];
    let dir = args[3];

    if (!db) {
      throw new Error("There's no database currently open");
    } else if (!table) {
      throw new Error("No table was specified");
    }

    // TODO: SQL INJECTION PART 2
    let columns = await previewDB.conn.all(
      `SELECT name FROM pragma_table_info("${table}")`,
    );
    let pk = (await previewDB.conn.all(`PRAGMA table_info(\`${table}\`)`)).find(
      (col) => col.pk === 1,
    ).name;

    columns.sort((a, b) => {
      if (a.name === pk) {
        return -1;
      }
      return 1;
    });

    let query = `SELECT ${formatColumns(columns.map((col) => col.name))} FROM \`${table}\``;

    if (orderBy) {
      query += ` ORDER BY \`${orderBy}\` ${dir}`;
    }

    query += ` LIMIT ${page * OFFSET}, ${OFFSET}`;

    let tableData = await previewDB.conn.all(query);

    return {
      columns: columns,
      data: tableData,
    };
  } catch (err) {
    console.error(err);
    return {
      type: "err",
      error: err,
    };
  }
});

/** Returns recent connections to databases */
ipcMain.handle("retrieve-tables", async () => {
  try {
    if (!db) {
      throw new Error("There's no database currently open");
    } else {
      let allTables = await previewDB.conn.all(
        "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
      );

      let tblData = {
        db: currentDBPath,
        tables: await Promise.all(
          allTables.map(async (tbl) => {
            try {
              // TODO: SQL INJECTION!!!!!!!!! Lovely absolutely lovely
              let columnNames = await previewDB.conn.all(
                `SELECT * FROM pragma_table_info("${tbl.name}")`,
              );

              return {
                tbl: tbl.name,
                columns: columnNames.map((col) => col.name),
              };
            } catch (err) {
              throw new Error(err);
            }
          }),
        ),
      };

      return tblData;
    }
  } catch (err) {
    console.error(err);
    return {
      type: "err",
      error: err,
    };
  }
});

/** Returns recent connections to databases */
ipcMain.handle("recent-connections", async () => {
  return store.get("recent-db");
});

/** Allows the user to open up a database on their file system */
ipcMain.handle("open-database", async (event, ...args) => {
  try {
    let dbPath = args[0];
    let sqlPath;

    if (!dbPath) {
      let pathSelect = await openDatabaseDialog();

      if (pathSelect && !pathSelect["canceled"]) {
        if (/.sql$/.test(pathSelect["filePaths"][0])) {
          sqlPath = pathSelect["filePaths"][0];
          // open new database dialog
          let selectLocation = await openSaveDialog();

          if (selectLocation && !selectLocation["canceled"]) {
            dbPath = selectLocation;
          } else {
            sqlPath = null;
            pathSelect = null;
          }
        } else {
          dbPath = pathSelect["filePaths"][0];
        }
      }
    }

    if (dbPath) {
      // send loading screen
      win.webContents.send("creating-database");

      if (db) {
        await db.close();
        db = null;
      }

      db = await getDBConnection(dbPath);
      await createPreviewDb(dbPath);

      if (sqlPath) {
        // populate the db
        let commands = await fsasync.readFile(sqlPath, "utf-8");
        await db.exec(commands);
        await previewDB.conn.exec(commands);
      }

      let existing = store.get("recent-db");

      if (!existing) {
        store.set("recent-db", [dbPath]);
      } else if (!existing.includes(dbPath)) {
        store.set("recent-db", [dbPath, ...existing]);
      }

      currentDBPath = dbPath;

      return {
        type: "success",
        res: currentDBPath,
      };
    } else {
      return {
        type: "neutral",
        err: "Nothing Selected",
      };
    }
  } catch (err) {
    return {
      type: "err",
      err: err,
    };
  }
});

/** Allows the user to create a new database */
ipcMain.handle("add-database", async () => {
  try {
    let selectedPath = await openSaveDialog();
    if (selectedPath && !selectedPath["canceled"]) {
      try {
        await fsasync.access(selectedPath);
        await fsasync.unlink(selectedPath);
      } catch (err) {
        // do nothing lol.
      }

      db = await getDBConnection(selectedPath);
      await createPreviewDb(selectedPath);

      let existing = store.get("recent-db");
      if (!existing) {
        store.set("recent-db", [selectedPath]);
      } else {
        store.set("recent-db", [...new Set([selectedPath, ...existing])]);
      }

      currentDBPath = selectedPath;

      return {
        type: "success",
        result: selectedPath,
      };
    } else {
      return {
        type: "pass",
        error: "No Path Selected",
      };
    }
  } catch (err) {
    return {
      type: "err",
      error: err,
    };
  }
});

/** Allows the user to create a new table in the given database */
ipcMain.handle("add-table", async (event, ...args) => {
  if (db) {
    try {
      let query = args[0];

      console.log(query);

      if (!query) {
        throw new Error("No query to run");
      }

      await db.run(query);
      await previewDB.conn.run(query);

      win.webContents.send("table-added");
      tableCreator.close();

      return "UPDATED TABLE";
    } catch (err) {
      console.error(err);
      return err.message;
    }
  } else {
    return "No database currently open";
  }
});

/** Clears the list of recently connected to databases */
ipcMain.handle("clear-connections", async () => {
  store.set("recent-db", []);
  return "Success";
});

/** Opens the table creator window */
ipcMain.handle("table-creator", openTableCreator);

/** FUNCTIONS ****************************************************/

/**
 * Retrieves either the desired color theme as specified by the user,
 * or the default color theme or the system
 * @returns Either an error response, or a success with the preferred theme
 */
async function getPrefersDark() {
  try {
    let localNativeTheme = await store.get("prefers-dark");

    if (localNativeTheme !== undefined) {
      return {
        type: "success",
        result: localNativeTheme,
      };
    }

    const theme = nativeTheme.shouldUseDarkColors;
    await store.set("prefers-dark", theme);

    return {
      type: "success",
      result: theme,
    };
  } catch (err) {
    console.error(err);
    return {
      type: "error",
      error: "There was an error on the server!",
    };
  }
}

/**
 * Copies a database into the tmp folder
 * @param {String} dbPath - path of the database to copy
 * @returns
 */
async function createPreviewDb(dbPath) {
  const OS_PATH = {
    win32: os.tmpdir(),
    darwin: "/tmp",
    linux: "/tmp",
  };

  if (!db || !OS_PATH[process.platform]) {
    throw new Error("nothing to copy");
  }

  await fsasync.copyFile(dbPath, `${OS_PATH[process.platform]}/tmp.db`);
  let tmpConn = await getDBConnection(`${OS_PATH[process.platform]}/tmp.db`);

  previewDB = {
    location: `${OS_PATH[process.platform]}/tmp.db`,
    conn: tmpConn,
  };
}

// // somewhere in your app.js (after all // endpoint definitions)
async function getDBConnection(name) {
  const db = await sqlite.open({
    filename: name,
    driver: sqlite3.Database,
  });

  // stop checking constraints
  // await db.exec("PRAGMA ignore_check_constraints = 1;");
  return db;
}

/**
 * Shows a dialog screen so the user can savefiles at a certain location
 * @returns The dialog window to interact with
 */
function openSaveDialog() {
  const options = {
    title: "Database Location",
    filters: [{ name: "Databases", extensions: ["db"] }],
    defaultPath: "~/Documents/Databases", // Optional: Provide a default path
    buttonLabel: "Choose Location", // Optional: Customize the button label
  };

  return dialog.showSaveDialogSync(options);
}

/**
 * Checks if a given SQL query is a SELECT statement
 * @param {String} sql - the SQL query to check
 * @returns Whether or not the SQL query is a SELECT statement
 */
function isSelectQuery(sql) {
  const selectPattern = /^SELECT/i;
  return selectPattern.test(sql);
}

/**
 * Shows a dialog screen so the user can open files at a certain location
 * @returns The dialog window to interact with
 */
async function openDatabaseDialog() {
  const options = {
    title: "Select a Database",
    filters: [
      { name: "Database", extensions: ["db", "sql"] },
      // { name: "SQL", extensions: ["sql"]},
    ],
    properties: ["openFile"],
  };

  return dialog.showOpenDialog(options);
}

/**
 * Opens up a dialog so that the user can select their csv files
 * @returns The dialog window to interact with
 */
async function openCSVDialog() {
  const options = {
    title: "Select a CSV File",
    filters: [{ name: "CSV File", extensions: ["csv"] }],
    properties: ["openFile"],
  };

  return dialog.showOpenDialog(options);
}

// Appends development-mode settings
if (env === "development") {
  require("electron-reload")(__dirname, {
    electron: path.join(__dirname, "node_modules", ".bin", "electron"),
    hardResetMethod: "exit",
  });
}

/** Creates a new browser window with all required settings */
const createWindow = async () => {
  if (db) {
    await db.close();
    db = null;
  }

  // technically not handling the error response from this function- ITS OKAY I SWEAR
  let colorTheme = (await getPrefersDark())?.result ? "dark" : "light";

  win = new BrowserWindow({
    width: 800,
    height: 600,
    icon: "/public/icons/Icon.jpg",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
      additionalArguments: [`--color-theme=${colorTheme}`]
    },
  });

  win.setMenu(null);

  win.on("closed", async () => {
    if (hasUnsavedChanges) {
      dialog.showErrorBox(
        "Unsaved Changes",
        "Your unsaved changes will be lost",
      );
    }

    if (db) {
      await db.close();
      await previewDB.conn.close();
      db = null;
      currentDBPath = null;
      win = null;
    }
  });

  win.loadFile("public/index.html");
  // win.webContents.setZoomFactor(1.0);
  // win.webContents.openDevTools()
};

/** Quits the app when the window is closed */
app.on("window-all-closed", async () => {
  try {
    if (db) {
      await db.close();
      await previewDB.conn.close();
    }
    if (process.platform !== "darwin") app.quit();
  } catch (err) {
    return "Error closing db";
  }
});

/** Initializer function */
app.whenReady().then(async () => {
  try {
    if (db) {
      console.log("REACHED!");
      await db.close();
      await previewDB?.conn?.close();

      db = null;
      previewDB = {};
    }

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (err) {}
});
