"use strict";
(function() {
  const ipc = require('electron').ipcRenderer;
  
  let pageViewing = 0;

  window.addEventListener("load", init);

  function init() {
    qsa("header > nav a").forEach((node) => node.addEventListener("click", openView));
    id("data-options-toggler").addEventListener("click", () => id("data-options").classList.toggle("collapsed"));
    id("add-database-button").addEventListener("click", addDatabase);
    id("clear-connections").addEventListener("click", promptForClear);
    id("table-name").addEventListener("change", async (e) => await openTableView(e.currentTarget.value));
    id("open-database-button").addEventListener("click", () => openDatabase());
    id("page-next").addEventListener("click", nextPage);
    id("page-back").addEventListener("click", prevPage);
    id("sql-executor").addEventListener("click", executeSql);
    id("sql-input").addEventListener("keyup", getTextAreaHeight);
    id("delete-selected").addEventListener("click", removeRows);
    id("add-new-row").addEventListener("click", addNewRow);
    id("save-changes").addEventListener("click", async () => {
      await saveNewChanges();
      id("data-options").classList.add("collapsed");
    });

    window.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        await saveNewChanges();
      }
    });

    getRecentConnections();

    ipc.once("edits-complete", async () => {
      await populateDbView();
      await populateDataViewerOptions();
    });
  }

  async function confirmDeleteTable(table) {
    let popup = document.createElement("dialog");
    let message = document.createElement("p");

    message.textContent = `Are you sure you want to delete ${table}?`;

    let buttonholder = document.createElement("div");
    buttonholder.classList.add("buttonholder");

    let yes = document.createElement("button");
    let no = document.createElement("button");

    yes.textContent = "Yes";
    no.textContent = "No";

    yes.classList.add("yes");
    no.classList.add("no");

    no.addEventListener("click", () => {
      qs("#database-structure div:not(.collapsed)")?.classList.add("collapsed");
      popup.remove();
    })
    yes.addEventListener("click", async () => {
      await deleteTable(table);
      popup.remove();
    })

    buttonholder.append(no, yes);
    popup.append(message, buttonholder);
    document.body.appendChild(popup);

    popup.showModal();
  }

  // Opens up a dialog that asks whether or not the user
  // want to delete the table
  async function deleteTable(tableName) {
    try {
      let res = await ipc.invoke("delete-table", tableName);
      if (res.type === "err") {
        throw new Error(res.err);
      }

      await populateDbView();
      await populateDataViewerOptions();
    } catch (err) {
      alert(err.message);
    }
  }

  async function saveNewChanges() {
    try {
      let newRows = qsa(".new-row");
      let modifiedRows = qsa(".modified");

      // take modified rows and update the table
      let modifiedMatrix = [...modifiedRows].map((row) => {
        return {
          pk: row.id,
          values: [...row.querySelectorAll("td:not(:first-of-type)")].map((cell) => cell.textContent)
        };
      })

      // take new row values and update the table
      let newRowMatrix = [...newRows].map((row) => {
        return [...row.querySelectorAll("td:not(:first-of-type)")].map((cell) => cell.textContent);
      });

      let columns = [...qsa("#table-view th:not(:first-of-type)")].map((col) => col.textContent);

      let res = await ipc.invoke("save-changes", id("table-name").value, columns, id("pk").textContent, newRowMatrix, modifiedMatrix);
      if (res.type === "err") {
        throw new Error(res.err);
      }

      newRows.forEach((row) => {
        row.classList.remove("new-row");
        // row.addEventListener("")
        row.querySelectorAll("td").forEach((col) => {
          col.addEventListener("input", function() {
            this.closest("tr").classList.add("modified");
            qs("a[href='#viewer']").classList.add("unsaved");
          });
        })
      });

      qsa(".modified").forEach((row) => {
        row.classList.remove("modified");
      });

      qs(".unsaved").classList.remove("unsaved");
    } catch (err) {
      alert(err.message);
    }
  }

  async function addNewRow() {
    try {
      let info = await retrieveNewRowInfo();

      if (info.type === "err") {
        throw new Error(info.err)
      }

      id("data-options").classList.add("collapsed");
      if (qs(".table-no-data-footer")) {
        qs(".table-no-data-footer").classList.add("hidden");
      }

      qs("a[href='#viewer']").classList.add("unsaved");

      let table = qs("#table-view table");
      let newRow = document.createElement("tr");

      newRow.id = info.lastID + 1;
      newRow.classList.add("new-row")

      let firstCol = document.createElement("td");
      let checkBox = document.createElement("input");
      checkBox.type = "checkbox";

      firstCol.appendChild(checkBox);
      newRow.prepend(firstCol);

      
      for (let i = 0; i < info.columns?.length; i++) {
        let col = info.columns[i];
        let newCol = document.createElement("td");

        if (col == info.pk && info.isAutoincrement) {
          // find the last id so it's not static
          newCol.textContent = info.lastID + 1;

          let updateCount = await ipc.invoke("increment-lastid", info.lastID + 1, id("table-name").value);
          if (updateCount.type == "err") {
            throw new Error(updateCount.err);
          }
        }

        newCol.contentEditable = true;
        newRow.appendChild(newCol);
      }

      table.insertBefore(newRow, table.querySelector("tr").nextSibling);

      if (table.querySelectorAll("tr").length > 11) {
        table.removeChild(table.lastChild);
      }
    } catch (err) {
      alert(err);
    }
  }

  async function retrieveNewRowInfo() {
    let activeTable = id("table-name").value;
    let meta = ipc.invoke("new-row-meta", activeTable);

    if (meta.type === "err") {
      throw new Error(meta.err);
    }
    
    return meta;
  }

  async function removeRows() {
    try {
      let activeTable = id("table-name").value;
      let rows = qsa("#table-view table input[type='checkbox']:checked");
      let rowIds = [...rows].filter((row) => {
        return !row.closest("tr").classList.contains("new-row")
      }).map((row) => {
        return row.closest("tr").id
      });

      if (activeTable && rowIds.length > 0) {
        await sendRowsToDeletion(rowIds, activeTable);
        [...rows].forEach((row) => {
          row.closest('tr').remove();
        });
      }

      id("data-options").classList.add("collapsed");
      // HERE
      await openTableView(activeTable);
      rows.forEach((row) => {
        row.closest("tr").remove();
      });

      if (qsa(".new-row, .modified").length === 0 && qs(".unsaved")) {
        qs(".unsaved").classList.remove("unsaved");
      }

    } catch (err) {
      alert(err.message);
    }
  }
  

  async function sendRowsToDeletion(rows, table) {
    let res = await ipc.invoke("remove-rows", rows, table);
    if (res.type === "error") {
      throw new Error(res.err)
    }
  }

  function getTextAreaHeight(e) {
    e.currentTarget.style.height = "1px";
    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
  }

  function prevPage() {
    pageViewing -= 1;
    if (pageViewing === 0) {
      id("page-back").classList.add("invisible");
    }

    if (id("page-next").classList.contains("invisible")) {
      id("page-next").classList.remove("invisible");
    }
    openTableView(id("table-name").value);
  }

  function nextPage() {
    pageViewing += 1;
    if (id("page-back").classList.contains("invisible")) {
      id("page-back").classList.remove("invisible");
    }
    openTableView(id("table-name").value);
  }

  async function executeSql() {
    let sql = id("sql-input").value;
    if (sql.trim()) {
      try {
        let res = await ipc.invoke("execute-sql", sql);
        if (res.type === "error") {
          throw new Error(res.err)
        }

        id("query-details").innerHTML = "";
        
        if (res.data) {
          // SELECT QUERY PROCESSING
          let table = buildResultsTable(res.data);
          let detailsMessage = document.createElement("p");
          detailsMessage.textContent = `
          Successfully executed query.
          ${res.details.numRows} row(s) returned.
          Took ${res.details.time}ms
          `;

          id("table-limiter").innerHTML = "";

          id("query-details").appendChild(detailsMessage);
          id("table-limiter").appendChild(table);
        } else {
          // INSERT/DELETE/WHATEVER ELSE CASE
          let detailsMessage = document.createElement("p");
          detailsMessage.textContent = `
          Successfully executed query.
          ${res.details.changes} change(s).
          Took ${res.details.time}ms.
          0 rows returned
          `

          id("table-limiter").textContent = "No rows returned";
          id("query-details").appendChild(detailsMessage);
        }
      } catch (err) {
        alert(err);
      }
    } else {
      alert("Please enter a sql query to execute it!")
    }
  }

  /** Might be redundant- idk if I've already done this and I don't want to look */
  function buildResultsTable(data) {
    let table = document.createElement("table");
    let header = document.createElement("tr");
    let columnNames = Object.keys(data[0]);

    columnNames.forEach((name) => {
      let headerCell = document.createElement("th");
      headerCell.textContent = name;

      header.appendChild(headerCell);
    });

    table.appendChild(header);

    data.forEach((row) => {
      let rowElem = document.createElement("tr");
      
      columnNames.forEach((key) => {
        let rowTd = document.createElement("td");

        rowTd.textContent = row[key];

        rowElem.appendChild(rowTd);
      });

      table.appendChild(rowElem);
    })

    return table;
  }

  async function populateDbView() {
    try {
      let dbInfo = await getTables();
      let dbViewContainer = createDbViewContainer(dbInfo);

      id("table-schema-view").innerHTML = "";
      id("table-schema-view").appendChild(dbViewContainer);
    } catch (err) {
      let errTag = gen("p");
      errTag.textContent = err;
      id("table-schema-view").innerHTML = "";
      id("table-schema-view").appendChild(errTag);
    }
  }

  async function closeDbConnection() {
    alert("NOOO! I HAVEN'T IMPLEMENT THIS YET")
  }

  function createDbViewContainer(dbInfo) {
    let holder = document.createElement("ul");
    let titlLi = document.createElement("li");
    let colsUl = document.createElement("ul");
    let dividr = document.createElement("hr");
    let title = document.createElement("div");
    let titleText = document.createElement("p");
    let closeDb = document.createElement("p");
    
    holder.id = "database-structure";
    titleText.textContent = dbInfo.db;

    closeDb.textContent = "Close Connection";
    closeDb.id = "close-connection";
    closeDb.addEventListener("click", closeDbConnection);

    title.append(titleText, closeDb);
    titlLi.append(title, dividr);

    dbInfo.tables.forEach((table) => {
      let tblLi = document.createElement("li");
      let tblP = document.createElement("p");
      // add the toggleabble view
      let optns = document.createElement("div");
      let edit = document.createElement("p");
      let delte = document.createElement("p");

      edit.textContent = "Edit";
      delte.textContent = "Delete";
      edit.classList.add("edit");
      delte.classList.add("delete");

      edit.addEventListener("click", async () => {
        try {
          await ipc.invoke("open-editor", table.tbl);
        } catch (err) {
          alert(err.message);
        }
      })

      delte.addEventListener("click", () => confirmDeleteTable(table.tbl));

      optns.append(edit, delte);
      optns.classList.add("collapsed");

      tblP.addEventListener("click", () => {
        optns.classList.toggle("collapsed");
      })

      tblP.textContent = `${table.tbl} (${table.columns.toString()})`;
      tblLi.append(tblP, optns);

      colsUl.appendChild(tblLi);
    });

    let lastLi = document.createElement("li");
    lastLi.id = "add-table";
    lastLi.textContent = "+ Add Table";
    lastLi.addEventListener("click", () => {
      id("add-table-options").classList.toggle("collapsed");
    });

    let addTableOptions = document.createElement("div");
    let fromCSV = document.createElement("p");
    let manual = document.createElement("p");

    addTableOptions.id = "add-table-options";
    addTableOptions.classList.add("collapsed");

    fromCSV.textContent = "From CSV";
    manual.textContent = "Manual Entry";

    fromCSV.addEventListener("click", (e) => {
      e.stopPropagation();
      openCSVPrompt();
    })

    manual.addEventListener("click", (e) => {
      e.stopPropagation();
      addManualTable();
    })

    addTableOptions.append(manual, fromCSV);

    lastLi.appendChild(addTableOptions);
    colsUl.appendChild(lastLi);

    titlLi.appendChild(colsUl);
    holder.appendChild(titlLi);
    return holder;
  }

  function gen(tag) {
    return document.createElement(tag);
  }

  async function openCSVPrompt() {
    try {
      ipc.invoke("csv-select");
      ipc.once("table-added", async () => {
        await populateDbView();
        await populateDataViewerOptions();
      });
    } catch (err) {
      alert(err);
    }
  }

  async function addManualTable() {
    try {
      ipc.invoke("table-creator");
      // Send back message once created, populate tables
      ipc.once("table-added", async () => {
        await populateDbView();
        await populateDataViewerOptions();
      });
    } catch (err) {
      alert(err);
    }
  }

  async function getTables() {
    try {
      let tables = await ipc.invoke('retrieve-tables');
      
      return {
        "db": tables["db"],
        "tables": tables["tables"].filter((table) => table.tbl !== "sqlite_sequence")
      };
    } catch (err) {
      alert(err);
    }
  }

  async function getDataFromTable(table) {
    try {
      let tableData = await ipc.invoke('view-data', table, pageViewing);
      return tableData;
    } catch (err) {
      alert(err);
    }
  }

  async function openDatabase(dbPath = "") {
    try {
      let currentDb = await ipc.invoke('open-database', dbPath);
      if (currentDb.type === "err") {
        throw new Error(currentDb.err);
      } else if (currentDb.type === "success") {
        setCurrentDbName(currentDb["res"]);
        await getRecentConnections();
        await populateDbView();
        await populateDataViewerOptions();
      }
    } catch (err) {
      console.error(err);
      alert(err);
    }
  }

  function setCurrentDbName(dbPath) {
    let filename = dbPath.split('/');
    filename = filename[filename.length - 1];
  
    qsa(".current-db-name").forEach((node) => node.textContent = filename)
  }

  function promptForClear() {
    let clearConfirm = confirm("Are you sure you want to clear your recent database connections?");

    if (clearConfirm) {
      clearConnections();
    }
  }

  async function clearConnections() {
    try {
      await ipc.invoke('clear-connections');

      await getRecentConnections();
      await populateDataViewerOptions();
    } catch (err) {
      alert(err);
    }
  }

  async function getRecentConnections() {
    try {
      let res = await ipc.invoke('recent-connections');
      populateRecentConnections(res);
    } catch (err) {
      alert(err);
    }
  }

  async function populateDataViewerOptions() {
    try {
      let tables = await getTables();
      tables = tables["tables"].map((table) => table.tbl);

      id("table-name").innerHTML = "";

      if (tables.length === 0) {
        let msg = document.createElement("p");
        msg.textContent = "There's no tables in this database!";

        qs("#table-view > div").classList.add("hidden");
        id("table-view").appendChild(msg);
      } else {
        // Populate table options
        [...tables].forEach((table) => {
          let tableOption = document.createElement("option");
          tableOption.value = table;
          tableOption.textContent = table;

          id("table-name").appendChild(tableOption);
        });

        // populate table view as first 
        await openTableView(tables[0]);
      }
    } catch (err) {
      alert(err);
    }
  }

  async function openTableView(table) {
    try {
      let tableData = await getDataFromTable(table);
      let tableMeta = await ipc.invoke("get-table-meta", table);

      let dataViewTable = document.createElement("table");
      let header = document.createElement("tr");

      ["Select", ...tableData.columns.map((col) => col.name)].forEach((column) => {
        let columnName = document.createElement("th");
        columnName.textContent = column;

        if (column == tableMeta.pk) {
          columnName.id = "pk";
        }
        
        header.appendChild(columnName);
      });

      dataViewTable.dataset.ai = tableMeta.isAutoincrement;
      dataViewTable.appendChild(header);

      qs("#table-view table")?.remove();
      qs("#table-view .table-no-data-footer")?.remove();

      if (tableData.data.length > 0) {
        tableData.data.forEach((rowData, i) => {
          let row = document.createElement("tr");
          let firstCol = document.createElement("td");
          let checkBox = document.createElement("input");
          checkBox.type = "checkbox";
  
          firstCol.appendChild(checkBox);
          row.appendChild(firstCol);
          row.id = rowData[tableMeta.pk];
  
          [...Object.keys(rowData)].forEach((col) => {
            let cell = document.createElement("td");
            cell.contentEditable = true;
            cell.textContent = rowData[col];

            cell.addEventListener("input", function() {
              this.closest("tr").classList.add("modified");
              qs("a[href='#viewer']").classList.add("unsaved");
            });
  
            row.appendChild(cell);
          });
          dataViewTable.appendChild(row);
        });
        
        id("table-view").appendChild(dataViewTable);

        if (tableData.data.length % 10 !== 0) {
          id("page-next").classList.add("invisible");
        } else {
          id("page-next").classList.remove("invisible");
        }
      } else {
        let footer = document.createElement("div");
        footer.classList.add("table-no-data-footer");

        let footerText = document.createElement("p");
        footerText.textContent = "There's no data there";

        footer.appendChild(footerText);
        id("table-view").append(dataViewTable, footer);
      }

    } catch (err) {
      alert(err);
    }
  };

  function populateRecentConnections(connections) {
    id("recent-connections").innerHTML = "";

    if (connections.length === 0) {
      let msg = document.createElement("p");
      msg.textContent = "Databases you connect to will be shown here (once you actually connect to them)";

      id("recent-connections").appendChild(msg)
    } else {
      connections.forEach((conn) => {
        let connectionFrame = createConnectionFrame(conn);
        id("recent-connections").appendChild(connectionFrame);
      });
    }
  }

  function createConnectionFrame(conn) {
    let connectionFrame = document.createElement("div");
    let icon = document.createElement("img");
    let meta = document.createElement("div");
    let title = document.createElement("p");
    let loc = document.createElement("p");

    let filename = conn.split('/');
    filename = filename[filename.length - 1];

    loc.textContent = conn;
    title.textContent = filename;
    icon.src = "./images/star-four-points.svg";
    icon.alt = "four-pointed star";

    meta.append(title, loc);
    connectionFrame.append(icon, meta);

    connectionFrame.addEventListener("click", async function() {
      await openDatabase(conn);
      // become first item
      this.parentNode?.insertBefore(this, id("recent-connections").firstChild);
    })

    return connectionFrame;
  }

  async function addDatabase() {
    try {
      let currentDb = await ipc.invoke('add-database');
      setCurrentDbName(currentDb);
      await populateDbView()

      await getRecentConnections();
      // await 
      await populateDataViewerOptions();
    } catch (err) {
      console.error(err);
      alert(`Something went wrong`)
    }
  }

  function openView(evt) {
    evt.preventDefault();

    let clickedTab = evt.currentTarget;
    let idToOpen = clickedTab.dataset.target;
    let viewToOpen = id(idToOpen)
    let currentlyOpenView = qs("main > section.active");
    let currentlyOpenTab = qs("nav > a.active");

    if (currentlyOpenTab !== viewToOpen) {
      currentlyOpenView.classList.remove("active");
      currentlyOpenTab.classList.remove("active");
      
      viewToOpen.classList.add("active");
      clickedTab.classList.add("active");
    }
  }

  function qs(query) {
    return document.querySelector(query);
  }

  function id(id) {
    return document.getElementById(id);
  }

  function qsa(query) {
    return document.querySelectorAll(query);
  }
})();