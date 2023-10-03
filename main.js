const { app, BrowserWindow, dialog, ipcMain } = require('electron');

const path = require('path')
const env = process.env.NODE_ENV || 'development';
const OFFSET = 10;
const os = require('os');

const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');

const Store = require('electron-store');
const store = new Store();

const fsasync = require('fs').promises;
const fs = require('fs');
const { parse } = require('csv-parse');
const { finished } = require('stream/promises');

let db;
let currentDBPath;
let win;
let tableCreator;
let tableEditor;
let editingTable;
let csvUpload;
let csvPath;

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
    // console.log("")
    // editingTable = null
    tableEditor = null
  })

  tableEditor.loadFile('public/tableeditor.html')
}

async function processCSVFile(delimiter = ",", firstRowIsColumns) {
  const records = [];
  const parser = fs
    .createReadStream(csvPath)
    .pipe(parse({
        delimiter: delimiter, // Change this to the delimiter used in your CSV file
        columns: firstRowIsColumns, // Set this to true if your CSV file has headers
      }));

  parser.on('readable', function(){
    let record; while ((record = parser.read()) !== null) {
    // Work with each record
      records.push(record);
    }
  });
  await finished(parser);
  return records;
}

ipcMain.handle("add-new-rows", async (event, ...args) => {
  try {
    let viewingTable = args[0];
    let columnValues = args[1];
    let columnNames = args[2];

    if (!previewDB?.conn || !db || !viewingTable || !columnNames || !columnValues) {
      throw new Error("Missing required arguments!");
    }

    let placeholderString = `(${columnNames.map(() => "?")})`;
    let query = `INSERT INTO ${viewingTable} (${formatColumns(columnNames)}) VALUES ${columnValues.map(() => placeholderString)}`;

    await previewDB.conn.exec("BEGIN TRANSACTION;");
    await previewDB.conn.run(query, columnValues.flat(1));
    await previewDB.conn.exec("COMMIT;")

    return {
      "type": "success"
    }
  } catch (err) {
    await previewDB.conn.exec("ROLLBACK;")

    return {
      "type": "err",
      "error": err
    }
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

    console.log("EDITING " + table)
    console.log(pk);
    console.log(pkValue);
    console.log(value);
    console.log(modifiedColumn);

    if (!table || !modifiedColumn || !value || !pk || !pkValue || !db || !previewDB.conn) {
      throw new Error("Missing required arguments!");
    }

    let query = `UPDATE ${table} SET \`${modifiedColumn}\` = ? WHERE \`${pk}\` = ?;`;
    let prevChanges = await previewDB.conn.run(query, value, pkValue);

    console.log(`UPDATE ${table} SET \`${modifiedColumn}\` = ? WHERE \`${pk}\` = ${pkValue};`);
    console.log(prevChanges);
    let res = await previewDB.conn.get(`SELECT * FROM ${table} WHERE ${pk} = ?`, prevChanges.lastID);
    console.log(res);

    return {
      "type": "success"
    }
  } catch (err) {
    return {
      "type": "err",
      "error": err
    }
  }
});

/** Updates the 'real' table to hold all the changes that have been made */
ipcMain.handle("commit-dataview-changes", async (event, ...args) => {
  try {
    let changedTable = args[0];

    if (!db || !previewDB || !changedTable) {
      throw new Error("Missing necessary input");
    }

    let tmp = Date.now();
    // begin transaction
    await db.exec(`BEGIN TRANSACTION;`);
    // drop original table
    await db.exec(`DELETE FROM ${changedTable};`);
    // attach staging database
    await db.exec(`ATTACH DATABASE "${previewDB.location}" AS ${tmp};`);
    // copy editing table contents into new table
    await db.exec(`INSERT INTO ${changedTable} SELECT * FROM \`${tmp}\`.\`${changedTable}\`;`)
    // commit transaction
    await db.exec(`COMMIT;`);
    // detach staging database
    await db.exec(`DETACH DATABASE ${tmp};`);

    console.log("Success!");
    return {
      "type": "success"
    }
  } catch (err) {
    await db.exec(`ROLLBACK;`);
    console.log("ERORORORORORORORORORORORO")

    return {
      "type": "err",
      "error": err
    }
  }
});

/**
 * Gets information about all other columns, aside from ones in
 * the given table
 */
ipcMain.handle("get-other-columns", async (event, ...args) => {
  try {
    if (!db || !editingTable) {
      throw new Error("No database or currently open table was given");
    }

    let ans = {};
    let tblnames = (await db.all(`SELECT tbl_name FROM sqlite_master WHERE tbl_name NOT LIKE "sqlite_sequence"`)).map((tbl) => tbl.tbl_name);

    for (const tbl of tblnames) {
      let colnames = (await db.all(`PRAGMA table_info("${tbl}")`)).map((col) => col.name);
      ans[tbl] = colnames
    }

    return {
      "type": "success",
      "results": ans
    }
  } catch (err) {
    console.error(err);
    return {
      "type": "err",
      "error": err
    }
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
      matches: results
    }

  } catch (err) {
    return {
      type: "err",
      error: err
    }
  }
});

/** Removes a connection from the list of recent connections */
ipcMain.handle("remove-connection", async (event, ...args) => {
  try {
    let pathToRemove = args[0];

    if (!pathToRemove) {
      throw new Error("Missing required arguments");
    }

    if (pathToRemove === currentDBPath) {
      await db.close();
      db = null;
    }

    const recentconnections = await store.get('recent-db');
    const index = recentconnections.indexOf(pathToRemove);
    if (index > -1) { // only splice array when item is found
      recentconnections.splice(index, 1); // 2nd parameter means remove one item only
    }

    console.log(recentconnections);

    await store.set('recent-db', recentconnections);

    return {
      "type": "success"
    }

  } catch (err) {
    return {
      type: "err",
      error: err
    }
  }
});

/** Searches all rows in a table that match a given query */
ipcMain.handle("search-table", async (event, ...args) => {
  try {
    if (!db || !previewDB.conn) {
      throw new Error("No database is open!")
    }

    let tablename = args[0];
    let columns = args[1];
    let searchquery = args[2];
    let page = args[3] || 0;

    if (tablename && columns) {
      let sqlquery = `SELECT * FROM \`${tablename}\` WHERE `;

      columns.forEach((colname, i) => {
        sqlquery += `\`${colname}\` LIKE "%${searchquery}%"${i === columns.length - 1 ? "" : " OR\n"}`;
      });

      sqlquery += `LIMIT ${page * OFFSET}, ${OFFSET}`;

      let res = await previewDB.conn.all(sqlquery);

      return {
        "type": "success",
        "results": res
      }
    } else {
      throw new Error("Missing required arguments")
    }
  } catch (err) {
    return {
      type: "err",
      error: err
    }
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
      type: "success"
    }
  } catch (err) {
    return {
      type: "error",
      error: err
    }
  }
});

ipcMain.handle("create-from-csv", async (event, ...args) => {
  try {
    if (!csvPath) {
      throw new Error("No filepath was specified");
    }

    const records = await processCSVFile(args[1], args[2]);
    let colNames = args[2] ? Object.keys(records[0]) : args[3];
    
    colNames = colNames.map((col, i) => {
      let value = records[1][Object.keys(records[0])[i]];
      return {
        name: col,
        type: /^[0-9]*$/.test(value) ? "INTEGER" : /^[0-9]*\.[0-9]*$/.test(value) ? "REAL" : "TEXT"
      }
    });

    const creationStmt = colNames.map((e) => {
      return `\n"${e.name}" ${e.type}`
    });

    creationStmt.push('\nPRIMARY KEY("id")');

    let query = "BEGIN TRANSACTION;\n";
    query += `\nCREATE TABLE "${args[0]}" (${creationStmt.toString()}\n);`

    let insertStatements = records.map((row) => {
      return `\nINSERT INTO "${args[0]}" (${colNames.map((e) => e.name).toString()}) VALUES (${formatColumns(Object.values(row))})`
    });

    query += insertStatements.join(";");

    console.log(query);
    await db.exec(query);
    await db.exec("COMMIT;");

    win.webContents.send("table-added");

    // win.webContents.send("edits-complete");
    csvUpload.close();

    return {
      "type": "success"
    }
  } catch (err) {
    await db.exec("ROLLBACK;");
    console.log(err);
    return {
      "type": "err",
      "err": err
    }
  }
});

ipcMain.handle("get-csv-data", async (event, ...args) => {
  try {
    if (!csvPath) {
      throw new Error("No filepath was specified");
    }

    const records = await processCSVFile(args[0], args[1]);
    console.log(records);

    return {
      "type": "success",
      "content": records.slice(0, 10)
    }

  } catch (err) {
    return {
      "type": "err",
      "err": err
    }
  }
});

ipcMain.handle("csv-select", async (event, ...args) => {
  try {
    let pathSelect = await openCSVDialog();
    if (pathSelect["canceled"]) {
      return {
        "type": "passive",
      }
    }
    
    csvPath = pathSelect["filePaths"][0];
    await openCSVEditor();

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

ipcMain.handle("get-foreign-keys", async (event, ...args) => {
  try {
    if (!editingTable || !db) {
      throw new Error("No table or database currently open!");
    }

    let query = `SELECT sql FROM sqlite_master WHERE type="table" and name=?`;
    let sql = await db.get(query, editingTable);
    let foreignKeys = {};
    sql.sql.split("\n")
      .filter((sentence) => {
        return /^FOREIGN KEY/g.test(sentence)
      })
      .forEach((fk) => {
        console.log(fk);
        let colInTable = fk.match(/(?<=FOREIGN KEY\(")[^")]*/g)
        let table = fk.match(/(?<=REFERENCES ").*(?="\()/g);
        let foreignCol = fk.match(/(?<=\(")[^"]*(?="\),$)/mg);

        console.log(colInTable);
        console.log(`${table}.${foreignCol}`)
        foreignKeys[colInTable] = `${table}.${foreignCol}`
      });

    return {
      "type": "success",
      "results": foreignKeys
    }
  } catch (err) {
    return {
      "type": "err",
      "error": err
    }
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
    let newColNames = args[2];
    let defaults = args[3];

    if (!creationStmt || !newName || !newColNames || !defaults) {
      throw new Error("Missing required arguments");
    }

    console.log(defaults)

    let ogColumns = (await db.all(`SELECT name FROM pragma_table_info("${editingTable}")`)).map((col, i) =>  {
      return defaults[i] ? `COALESCE(\`${col.name}\`, "${defaults[i].replace(/'/g, "''")}")` : `\`${col.name}\``;
    });

    for (let i = 0; i < (newColNames.length - ogColumns.length); i++) {
      ogColumns.push(defaults[i + ogColumns.length] ? `TEXT("${defaults[i + ogColumns.length]})"` : "NULL")
    }

    console.log(ogColumns);

    // console.log(ogColumns);
    let query = "PRAGMA foreign_keys=off;\nBEGIN TRANSACTION;";
    let tmpname = `"${Date.now()}"`;

    query += `\nCREATE TABLE ${tmpname} (\n${creationStmt}\n);`;
    query += `\nINSERT INTO ${tmpname} (${newColNames}) SELECT ${ogColumns} FROM \`${editingTable}\`;`;
    query += `\nDROP TABLE "${editingTable}";`;
    query += `\nALTER TABLE ${tmpname} RENAME TO \`${newName}\`;`;

    // COALESCE 
    console.log("QUERY");
    console.log(query);

    await db.exec(query);
    await previewDB.conn.exec(query);

    await db.exec("\nCOMMIT;\nPRAGMA foreign_keys=on;")
    await previewDB.conn.exec("\nCOMMIT;\nPRAGMA foreign_keys=on;")

    editingTable = newName;
    win.webContents.send("edits-complete");

    return {
      "type": "success"
    }
    
  } catch (err) {
    await db.exec("ROLLBACK;\nPRAGMA foreign_keys=on;");
    console.log("ERROR HERE")
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

    editingTable = args[0];
    openTableEditor();
    

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

    let query = `DROP TABLE IF EXISTS "${tablename}"`;
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

    if (!db || !previewDB.conn) {
      throw new Error("No database currently open!");
    }

    if (!table || !columns || !pk) {
      throw new Error("Missing required parameters.")
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

    console.log(qry);

    await previewDB.conn.exec(qry);
    await previewDB.conn.exec("COMMIT;");

    win.webContents.send("edits-complete");

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
;
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
    let columns = await db.all(`PRAGMA table_info("${table}")`);
    let pk = columns.find((col) => col.pk === 1);

    let sql = await db.get("SELECT sql FROM sqlite_master WHERE name = ?", table);
    let keys = sql.sql.match(/(?<=^").*(?=".*DEFAULT.*\n)/gm);
    let values = sql.sql.match(/(?<=DEFAULT ").*(?=")/g);
    
    let def = keys?.reduce((result, key, index) => {
      result[key] = values[index];
      return result;
    }, {});

    let lastid;

    if (isAutoincrement) {
      lastid = await db.get("SELECT seq FROM sqlite_sequence WHERE name = ?", table);
    }
    
    return {
      "pk": pk.name,
      "columns": columns.map((col) => col.name),
      "defaults": def,
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
      console.log(editingTable);
      tblname = args[0] || editingTable;

      if (!tblname) {
        throw new Error("Please provide a table name!");
      }

      let getCreateStmt = "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ?";
      let isAutoincrement = "SELECT * FROM sqlite_master WHERE type = 'table' AND name = ? AND sql LIKE '%AUTOINCREMENT%'";
      let results = await db.get(getCreateStmt, tblname);

      if (results) {
        // TODO: Fun- sql injection potentially
        let getPk = 'PRAGMA table_info("' + tblname + '")';
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
    console.error(err);
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
    let columns = await previewDB.conn.all(`SELECT name FROM pragma_table_info("${table}")`); 
    let tableData = await previewDB.conn.all(`SELECT * FROM \`${table}\` LIMIT ${page * OFFSET}, ${OFFSET}`);

    return {
      "columns": columns,
      "data": tableData
    };
  } catch (err) {
    console.error(err);
    return {
      "type": "err",
      "error": err
    };
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
            let columnNames = await db.all(`SELECT * FROM pragma_table_info("${tbl.name}")`);

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
    console.error(err);
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
    let sqlPath;

    if (!dbPath) {
      let pathSelect = await openDatabaseDialog();
      
      if (!pathSelect["canceled"]) {
        if (/.sql$/.test(pathSelect["filePaths"][0])) {
          sqlPath = pathSelect["filePaths"][0];
          // open new database dialog
          let selectLocation = openSaveDialog();

          if (!selectLocation["canceled"]) {
            dbPath = selectLocation;
          }
          
        } else {
          dbPath = pathSelect["filePaths"][0];
        }
      }
    }

    if (dbPath) {
      if (db) {
        await db.close();
        db = null;
      }
      
      db = await getDBConnection(dbPath);
      await createPreviewDb(dbPath);
      console.log(previewDB)
      

      if (sqlPath) {
        // populate the db
        let commands = await fsasync.readFile(sqlPath, "utf-8");
        await db.exec(commands);
      }

      let existing = store.get('recent-db');

      // console.log(existing);
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
      await createPreviewDb(selectedPath);
      console.log(previewDB)
      

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
      await previewDB.conn.run(query);

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

/**
 * Copies a database into the tmp folder
 * @param {String} dbPath - path of the database to copy
 * @returns 
 */
async function createPreviewDb(dbPath) {
  const OS_PATH = {
    "win32": os.tmpdir(),
    "darwin": "/tmp",
    "linux": "/tmp"
  }

  if (!db || !OS_PATH[process.platform]) {
    throw new Error("nothing to copy");
  }

  await fsasync.copyFile(dbPath, `${OS_PATH[process.platform]}/tmp.db`);
  let tmpConn = await getDBConnection(`${OS_PATH[process.platform]}/tmp.db`);

  previewDB = {
    "location": `${OS_PATH[process.platform]}/tmp.db`,
    "conn": tmpConn
  }
}

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
    filters: [
      {name: "Databases", extensions: ['db']},
    ],
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
      { name: 'Database', extensions: ['db', 'sql'] },
      // { name: "SQL", extensions: ["sql"]},
    ],
    properties: ['openFile']
  }

  return dialog.showOpenDialog(options);
}

/**
 * Opens up a dialog so that the user can select their csv files
 * @returns The dialog window to interact with
 */
async function openCSVDialog() {
  const options = {
    title: 'Select a CSV File',
    filters: [
      { name: 'CSV File', extensions: ['csv'] },
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