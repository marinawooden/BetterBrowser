const { app, BrowserWindow, dialog, ipcMain } = require('electron');

const path = require('path')
const env = process.env.NODE_ENV || 'development';
const OFFSET = 10;

const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');

const Store = require('electron-store');
const store = new Store();

let db;
let currentDBPath;
let win;
let tableCreator;
let tableEditor;
let editingTable;
let csvUpload;

const openTableCreator = () => {
  tableCreator = new BrowserWindow({
    width: 600,
    height: 450,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  tableCreator.loadFile('public/tablecreator.html')
  // tableCreator.webContents.openDevTools();
}

const openCSVEditor = () => {
  csvUpload = new BrowserWindow({
    width: 600,
    height: 450,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  csvUpload.loadFile('public/uploadcsv.html')
}

const openTableEditor = () => {
  tableEditor = new BrowserWindow({
    width: 600,
    height: 450,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  tableEditor.on('closed', () => {
    editingTable = null
    tableEditor = null
  })

  tableEditor.loadFile('public/tableeditor.html')
}

ipcMain.handle("get-constraints", async (even, ...args) => {
  try {
    if (!editingTable || !db) {
      throw new Error("No table or database currently open!");
    }

    let query = `SELECT sql FROM sqlite_master WHERE type="table" and name=?`;
    let sql = await db.get(query, editingTable);
    let constraints = sql.sql.split("\n")
    .filter((sentence) => sentence[0] === '"')
    .map((col) => {
      let nn = /NOT NULL/.test(col)
      let def = col.match(/(?<=DEFAULT ").*(?=")/)
      let u = /UNIQUE/.test(col)

      return {
        "nn": nn,
        "default": def ? def[0] : def,
        "u": u
      }
    });

    return {
      "type": "success",
      "results": constraints
    }
  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
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
    let query = `ALTER TABLE ${editingTable} DROP COLUMN ${coltodrop};`;

    await db.exec(query);

    win.webContents.send("edits-complete");

    return {
      "type": "success"
    }

  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

/**
 * Updates an existing table in the database (copies data and replaces)
 */
ipcMain.handle('update-table', async (event, ...args) => {
  try {
    if (!db || !editingTable) {
      throw new Error("No table or database open");
    }
    if (!args[0] || !args[1]) {
      throw new Error("Missing required parameters!")
    }

    let creationStmt = args[0];
    let newName = args[1];

    let ogColumns = (await db.all("SELECT name FROM pragma_table_info('" + editingTable + "')")).map((col) =>  `"${col.name}"`);

    console.log(ogColumns);
    let query = "PRAGMA foreign_keys=off;\nBEGIN TRANSACTION;";
    let tmpname = `"${Date.now()}"`;

    query += `\nCREATE TABLE ${tmpname} (\n${creationStmt}\n);`;
    query += `\nINSERT INTO ${tmpname} (${ogColumns.toString()}) SELECT * FROM '${editingTable}';`
    query += `\nDROP TABLE ${editingTable};`
    query += `\nALTER TABLE ${tmpname} RENAME TO '${newName}';`

    console.log("QUERY");
    console.log(query);

    await db.exec(query);
    await db.exec("\nCOMMIT;\nPRAGMA foreign_keys=on;")
    editingTable = newName;

    win.webContents.send("edits-complete");

    return {
      "type": "success"
    }
    
  } catch (err) {
    await db.exec("ROLLBACK;\nPRAGMA foreign_keys=on;");

    console.log(err);
    return {
      "type": "err",
      "err": err.code == "SQLITE_CONSTRAINT" ? err.message + ".  Try adding a default value to this column." : err
    }
  }
});

/**
 * Puts doublesquotes around each column in a list of column names
 * @param {Array} colnames - names of columns
 * @returns String of quotes comma-separated column names
 */
function formatColumns(colnames) {
  ans = "";
  colnames.forEach((name, i) => {
    ans += `"${name}${(i + 1) < colnames.length ? '", ' : '"'}`;
  });

  return ans;
}

ipcMain.handle('update-table-old', async (event, ...args) => {
  try {
    if (!editingTable) {
      throw new Error("No table currently open")
    }

    let colnames = args[0];
    // colnames = [[colname, definition]]
    let newnames = args[1];
    // newnames = [[oldname, newname]]
    let newtablename = args[2];
    
    
    let qry = "BEGIN TRANSACTION"

    colnames.forEach((newcol) => {
      qry += `\nALTER TABLE ${editingTable} ADD '${newcol[0]}' ${newcol[1]};`;
    });

    newnames.forEach((namechange, i) => {
      qry += `\nALTER TABLE ${editingTable} RENAME COLUMN ${namechange[0]} TO ${namechange[1]}`
    });

    if (newtablename) {
      qry += `\nALTER TABLE ${editingTable} RENAME TO ${newtablename}`;
    }
    
    qry += "\nCOMMIT;";

    console.log(qry)

    // refresh main page
    return {
      "type": "success"
    }
  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

/**
 * Opens the table editor, stores the current table name
 * in the main handler
 */
ipcMain.handle('open-editor', async (event, ...args) => {
  try {
    if (tableEditor) {
      tableEditor.close()
    }

    if (!db) {
      // can't technically be reached but just to be safe
      throw new Error("There's no database currently open!");
    }

    if (!args[0]) {
      throw new Error("Please provide a table to edit")
    }

    openTableEditor();
    editingTable = args[0]

    return {
      "type": "success"
    }

  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

// Handles deleting a table from the currently open database,
// given a table name
ipcMain.handle('delete-table', async (event, ...args) => {
  try {
    // open up confirmation tab
    let tablename = args[0];

    if (!db) {
      throw new Error("There's no database currently open");
    }

    if (!tablename) {
      throw new Error("Please provide a table name");
    }

    let query = `DROP TABLE IF EXISTS ${tablename}`;
    await db.exec(query);

    return {
      "type": "success"
    }
  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

/**
 * Updates a sqlite table
 */
ipcMain.handle('save-changes', async (event, ...args) => {
  try {
    let table = args[0];
    let columns = args[1];
    let pk = args[2];
    let newValues = args[3];
    let modifiedRows = args[4];

    if (!db) {
      throw new Error("No database currently open!");
    }

    if (!table || !columns || !pk) {
      throw new Error("Missing required parameters.")
    }

    qry = "\nBEGIN TRANSACTION;";
    
    if (newValues?.length > 0) {
      for (const arr of newValues) {
        // bleh.  Need to find out how to use placeholders
        qry += `\nINSERT INTO ${table} (${columns.toString()}) VALUES (${formatColumns(arr)});`;
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

    console.log(qry);
    await db.exec(qry);
    await db.exec("COMMIT;");


    return {
      "type": "success"
    }
  } catch (err) {
    // console.log("ERROR HANDLING REACHED")
    await db.exec("ROLLBACK;");

    return {
      "type": "err",
      "err": err
    }
  }
});

ipcMain.handle('increment-lastid', async (event, ...args) => {
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

    console.log(newId);
    let test = await db.get("SELECT * FROM sqlite_sequence WHERE name = ?", table);
    if (test) {
      await db.run("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", newId, table);
    }

    return {
      "type": "success"
    };
  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

ipcMain.handle('new-row-meta', async (event, ...args) => {
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

    let isAutoincrement = await db.get("SELECT * FROM sqlite_master WHERE type = 'table' AND name = ? AND sql LIKE '%AUTOINCREMENT%'", table);
    let columns = await db.all(`PRAGMA table_info(${table})`);
    let pk = columns.find((col) => col.pk === 1);
    let lastid;

    if (isAutoincrement) {
      lastid = await db.get("SELECT seq FROM sqlite_sequence WHERE name = ?", table);
    }
    
    
    return {
      "pk": pk.name,
      "columns": columns.map((col) => col.name),
      "types": columns.map((col) => col.type),
      "isAutoincrement": !(!isAutoincrement),
      "lastID": lastid ? lastid.seq : 0
    }

  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

ipcMain.handle('remove-rows', async (event, ...args) => {
  try {
    let rows = args[0];
    let table = args[1];

    if (!db) {
      throw new Error("There's no database currently open!");
    }

    if (!table) {
      throw new Error("Please provide a table to delete from.");
    }

    if (rows.length > 0) {
      // TODO: Yikes
      // Also, I feel like we can do `pk` by modifying `getPk`.  Don't want to rewrite rn though
      let columns = await db.all(`PRAGMA table_info(${table})`);
      let pk = columns.find((col) => col.pk === 1);

      let query = `DELETE FROM "${table}" WHERE "${pk["name"]}" in (${rows.toString()})`;
      console.log(query);
      let start = Date.now();
      let meta = await db.run(query);

      return {
        "changes": meta.changes || 0,
        "duration": Date.now - start
      }
    }
  } catch (err) {
    return {
      "type": "error",
      "err": err
    }
  }
});

ipcMain.handle('get-table-meta', async (event, ...args) => {
  try {
    if (db) {
      tblname = args[0] || editingTable;

      if (!tblname) {
        throw new Error("Please provide a table name!");
      }

      let getCreateStmt = "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ?";
      let isAutoincrement = "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ? AND sql LIKE '%AUTOINCREMENT%'";
      let results = await db.get(getCreateStmt, tblname);

      if (results) {
        // TODO: Fun- sql injection potentially
        let getPk = "PRAGMA table_info(" + tblname + ")";
        let columns = await db.all(getPk);
        let pk = columns.find((col) => col.pk === 1);

        return {
          "name": tblname,
          "sql": results.sql,
          "pk": pk.name,
          "isAutoincrement": !(!isAutoincrement)
        };
      } else {
        throw new Error("That table doesn't exist!");
      }

    } else {
      throw new Error("No database currently open!");
    }
  } catch (err) {
    return {
      "type": "err",
      "error": err
    };
  }
  
});

ipcMain.handle('execute-sql', async (event, ...args) => {
  let sql = args[0];

  if (db) {
    try {
      if (!sql) {
        throw new Error("Please specify a sql query!");
      } else {
        let startTime = Date.now();
        let res;
        if (isSelectQuery(sql)) {
          res = await db.all(sql);
        } else {
          res = await db.run(sql);
        }
        return {
          "type": "success",
          "data": res.length ? res : null,
          "details": {
            "time": Date.now() - startTime,
            "numRows": res.length,
            "changes": res.changes || 0,
            "lastID": res.lastID
          }
        };
      }
    } catch (err) {
      return {
        "type": "error",
        "err": err
      };
    }
  } else {
    return {
      "type": "error",
      "err": "There's no database currently open!"
    }
  }
});

ipcMain.handle('view-data', async (event, ...args) => {
  try {
    let table = args[0];
    let page = args[1] || 0;

    if (!db) {
      throw new Error("There's no database currently open");
    } else if (!table) {
      throw new Error("No table was specified");
    }

    // TODO: SQL INJECTION PART 2
    let columns = await db.all("SELECT name FROM pragma_table_info('" + table + "')"); 
    let tableData = await db.all(`SELECT * FROM '${table}' LIMIT ${page * OFFSET}, ${OFFSET}`);

    return {
      "columns": columns,
      "data": tableData
    };
  } catch (err) {
    console.error(err);
    return "Error";
  }
})

/** Returns recent connections to databases */
ipcMain.handle('retrieve-tables', async () => {
  try {
    if (!db) {
      throw new Error("There's no database currently open")
    } else {
      let allTables = await db.all("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name");
      let tblData = {
        "db": currentDBPath,
        "tables": await Promise.all(allTables.map(async (tbl) => {
          try {
            // TODO: SQL INJECTION!!!!!!!!! Lovely absolutely lovely
            let columnNames = await db.all("SELECT * FROM pragma_table_info('" + tbl.name + "')");

            return {
              "tbl": tbl.name,
              "columns": columnNames.map((col) => col.name),
            }
          } catch (err) {
            throw new Error(err);
          }
        }))
      }
      
      return tblData;
    }
  } catch (err) {
    console.log(err);
    return "Error"
  }
})

/** Returns recent connections to databases */
ipcMain.handle('recent-connections', async () => {
  return store.get('recent-db');
})

/** Allows the user to open up a database on their file system */
ipcMain.handle('open-database', async (event, ...args) => {
  try {
    let dbPath = args[0];
    console.log("REACHED POINT")
    if (!dbPath) {
      let pathSelect = await openDatabaseDialog();
      
      if (!pathSelect["canceled"]) {
        dbPath = pathSelect["filePaths"][0];
      }
    }
    
    if (db) {
      await db.close();
    }

    if (dbPath) {
      db = await getDBConnection(dbPath);

      let existing = store.get('recent-db');

      console.log(existing);
      if (!existing) {
        store.set('recent-db', [dbPath]);
      } else if (!existing.includes(dbPath)) {
        store.set('recent-db', [dbPath, ...existing]);
      }

      currentDBPath = dbPath;

      return {
        "type": "success",
        "res": currentDBPath
      }
    } else {
      return {
        "type": "neutral",
        "err": "Nothing Selected"
      }
    }
  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

/** Allows the user to create a new database */
ipcMain.handle('add-database', async () => {
  try {
    let selectedPath = openSaveDialog();

    if (selectedPath) {
      db = await getDBConnection(selectedPath);

      let existing = store.get('recent-db');

      if (!existing) {
        store.set('recent-db', [selectedPath]);
      } else {
        store.set('recent-db', [selectedPath, ...existing]);
      }

      currentDBPath = selectedPath;

      return selectedPath;
    } else {
      return "No Path Selected";
    }
  } catch (err) {
    return err.message;
  }
});

/** Allows the user to create a new table in the given database */
ipcMain.handle('add-table', async (event, ...args) => {
  if (db) {
    try {
      let query = args[0];
      await db.run(query);

      win.webContents.send("table-added");
      tableCreator.close();

      return "UPDATED TABLE";
    } catch (err) {
      console.log(err);
      return err.message;
    }
  } else {
    return "No database currently open"
  }
});

/** Clears the list of recently connected to databases */
ipcMain.handle('clear-connections', async () => {
  store.set('recent-db', []);
  return "Success"
});

/** Opens the table creator window */
ipcMain.handle('table-creator', openTableCreator);

// // somewhere in your app.js (after all // endpoint definitions)
async function getDBConnection(name) {
  const db = await sqlite.open({
      filename: name,
      driver: sqlite3.Database
  });
  return db;
} 

/**
 * Shows a dialog screen so the user can savefiles at a certain location
 * @returns The dialog window to interact with
 */
function openSaveDialog() {
  const options = {
    title: 'Database Location',
    filters: [{
      name: "Databases",
      extensions: ['db']
    }],
    defaultPath: '~/Documents/Databases', // Optional: Provide a default path
    buttonLabel: 'Choose Location', // Optional: Customize the button label
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
    title: 'Select a Database',
    filters: [
      { name: 'Database', extensions: ['db'] },
    ],
    properties: ['openFile']
  }

  return dialog.showOpenDialog(options);
}

// Appends development-mode settings
if (env === 'development') {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

/** Creates a new browser window with all required settings */
const createWindow = async () => {
  if (db) {
    await db.close();
    db = null;
  }
  
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  win.on("closed", async () => {
    if (db) {
      await db.close();
      db = null;
      currentDBPath = null;
      win = null;
    }
  });

  win.loadFile('public/index.html')
  // win.webContents.openDevTools()
}

/** Quits the app when the window is closed */
app.on('window-all-closed', async () => {
  try {
    if (db) {
      await db.close();
    }
    if (process.platform !== 'darwin') app.quit()
  } catch (err) {
    return "Error closing db";
  }
})

/** Initializer function */
app.whenReady().then(async () => {
  try {
    if (db) {
      await db.close()
    }

    createWindow()
  
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    console.log("Something went wrong: " + err.message);
  }
  
})