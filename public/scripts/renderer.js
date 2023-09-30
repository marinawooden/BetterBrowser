"use strict";
(function() {
  const ipc = require('electron').ipcRenderer;
  
  let selectedRows = [];
  let editingRows = {};
  let pageViewing = 0;
  let newRows = [];

  window.addEventListener("load", init);

  function init() {
    qsa("header > nav a").forEach((node) => node.addEventListener("click", openView));
    id("data-options-toggler").addEventListener("click", () => id("data-options").classList.toggle("collapsed"));
    id("add-database-button").addEventListener("click", addDatabase);
    id("clear-connections").addEventListener("click", promptForClear);
    id("table-name").addEventListener("change", async (e) => {
      pageViewing = 0;
      selectedRows = [];
      await openTableView(e.currentTarget.value);
      id("select-all").textContent = "Select All Rows";
      id("select-all").classList.remove("selected");
    });
    id("open-database-button").addEventListener("click", () => openDatabase());
    id("page-next").addEventListener("click", nextPage);
    id("page-back").addEventListener("click", prevPage);
    id("sql-executor").addEventListener("click", executeSql);
    id("sql-input").addEventListener("keyup", getTextAreaHeight);
    id("delete-selected").addEventListener("click", removeRows);
    id("add-new-row").addEventListener("click", addNewRow);
    id("select-all").addEventListener("click", function() {
      if (!this.classList.contains("selected")) {
        selectAllVisibleRows(this);
      } else {
        selectedRows = [];
        qsa("#table-view input[type='checkbox']:checked").forEach((input) => input.checked = false);
        this.textContent = "Select All Rows";
        this.classList.remove("selected");
        id("data-options").classList.add("collapsed")
      }
    });
    id("save-changes").addEventListener("click", async () => {
      await saveNewChanges();
      id("data-options").classList.add("collapsed");
    });

    id("search-table").addEventListener("input", () => {
      pageViewing = 0;
      id("page-back").classList.add("invisible");
      searchForQuery()
    });

    window.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        await saveNewChanges();
      }
    });

    getRecentConnections();

    window.addEventListener("resize", () => {
      responsiveDataViewColumns(qs("#table-view table"))
    });
  }

  async function selectAllVisibleRows(elem) {
    try {
      let tablename = id("table-name").value;
      let colnames = [...qsa("#table-view th")].map((col) => col.textContent);
      let searchterm = id("search-table").value.trim();

      colnames.shift();

      let res = await ipc.invoke("select-all-rows", tablename, colnames, searchterm);
      if (res.type === "err") {
        throw new Error(res.error);
      }

      let pk = id("pk").textContent;
      let formattedMatches = res.matches.map((row) => row[pk] + "");

      selectedRows = formattedMatches;

      // everything on current page visible
      qsa("#table-view input[type='checkbox']").forEach((checkbox) => {
        checkbox.checked = true;
      });

      id("data-options").classList.add("collapsed");
      elem.textContent = "Deselect All Rows"
      elem.classList.add("selected");
    } catch (err) {
      handleError(err);
    }
  }

  function recordCheck() {
    let val = this.closest("tr").id;
    if (this.checked) {
      selectedRows.push(val);
      console.log(selectedRows);

    } else {
      let i = selectedRows.indexOf(val);
      selectedRows.splice(i, 1);
    }
  }

  async function removePreviousConnection(e) {
    try {
      let toRemove = e.currentTarget.parentNode;
      let toRemoveName = toRemove.querySelector("p:last-of-type").textContent;
      
      let res = await ipc.invoke("remove-connection", toRemoveName);
      if (res.type === "err") {
        throw new Error(res.error);
      }

      toRemove.remove();

      if (qs("#database-structure p").textContent === toRemoveName) {
        id("database-structure").remove();
        let noDatabaseOpenText = document.createElement("p");
        noDatabaseOpenText.textContent = "No database is currently open, please create one or open one from a file";

        id("table-schema-view").appendChild(noDatabaseOpenText);
        id("table-name").innerHTML = "";
        qs("#table-view table").remove();
      }

      if (!qs("#recent-connections *")) {
        let noRecentConnection = document.createElement("p");
        noRecentConnection.textContent = "Databases you connect to will be shown here (once you actually connect to them)";

        id("recent-connections").appendChild(noRecentConnection)
      }
      // await populateDbView();
      // await populateDataViewerOptions();
    } catch (err) {
      handleError(err);
    }
  }

  async function searchForQuery(page = 0) {
    try {
      let colnames = [...qsa("#table-view th:not(:first-of-type)")].map((elem) => elem.textContent);
      let tablename = id("table-name").value;
      let searchterm = id("search-table").value;

      let res = await ipc.invoke("search-table", tablename, colnames, searchterm, page);
      if (res.type === "err") {
        throw new Error(res.error);
      }
      showSearchResults(res.results);
    } catch (err) {
      console.error(err);
      handleError(err);
    }
  }

  function showSearchResults(results) {
    qsa("#table-view table tr:not(:first-of-type)").forEach((row) => row.remove());

    results.forEach((result) => {
      let row = document.createElement("tr");
      let pk = id("pk").textContent;

      let checkboxCol = document.createElement("td");
      let checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkboxCol.appendChild(checkbox);

      if (selectedRows.includes(result[pk] + "")) {
        checkbox.checked = true;
      }

      checkbox.addEventListener("click", recordCheck)
      row.append(checkboxCol);
      
      [...Object.keys(result)].forEach((col) => {
        let content = document.createElement("td");
        let contentHolder = document.createElement("p")

        contentHolder.contentEditable = true;
        contentHolder.textContent = result[col];
        contentHolder.addEventListener("input", function() {
          this.closest("tr").classList.add("modified");
          qs("a[href='#viewer']").classList.add("unsaved");

          editingRows[id("table-name").value] = editingRows[id("table-name").value] || {};
          editingRows[id("table-name").value][this.closest("tr")["id"]] = getRowContents(this.closest("tr"));
        });

        content.appendChild(contentHolder);
        row.appendChild(content);
      });

      row.id = result[pk];
      qs("#table-view table").appendChild(row);
    });

    responsiveDataViewColumns(qs("#table-view table"));

    if (results.length % 10 !== 0 || results.length === 0) {
      id("page-next").classList.add("invisible");

      if (pageViewing === 0) {
        id("page-back").classList.add("invisible");
      }
    } else {
      id("page-next").classList.remove("invisible");
    }
  }

  function getRowContents(row) {
    let keys = [...qsa("#table-view th")].map((col) => col.textContent);
    let values = [...row.querySelectorAll("td")].map((row) => row.textContent);
    values.shift();
    keys.shift();

    return keys.reduce((result, key, index) => {
      result[key] = values[index];
      return result;
    }, {});
  }

  function responsiveDataViewColumns(table) {
    // the max width
    // qs("#viewer")
    // qsa("#table-view th")

    let tableWidth = table.parentNode?.offsetWidth - 210;
    let numColumns = table.querySelectorAll("th").length - 1;

    let content = table.querySelectorAll("p");

    [...content].forEach((elem) => {
      elem.style.maxWidth = `${tableWidth / numColumns}px`;
      elem.style.minWidth = `${tableWidth / numColumns}px`;
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

            editingRows[id("table-name").value] = editingRows[id("table-name").value] || {};
            editingRows[id("table-name").value][this.closest("tr")["id"]] = getRowContents(this.closest("tr"));
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

      // PROBLEMATIC since pk might not be an integer
      newRow.id = info.lastID + 1;
      newRow.classList.add("new-row");

      let firstCol = document.createElement("td");
      let checkBox = document.createElement("input");
      checkBox.type = "checkbox";
      if (selectedRows.includes(newRow.id + "")) {
        checkBox.checked = true;
      }

      checkBox.addEventListener("click", recordCheck)

      firstCol.appendChild(checkBox);
      newRow.prepend(firstCol);

      console.log(info);
      for (let i = 0; i < info.columns?.length; i++) {
        let col = info.columns[i];
        let colHolder = document.createElement("td");
        let newCol = document.createElement("p");
        let def = info.defaults[col];
        newCol.textContent = def || "";

        if (col == info.pk && info.isAutoincrement) {
          // find the last id so it's not static
          newCol.textContent = info.lastID + 1;

          let updateCount = await ipc.invoke("increment-lastid", info.lastID + 1, id("table-name").value);
          if (updateCount.type == "err") {
            throw new Error(updateCount.err);
          }
        }

        newCol.contentEditable = true;

        newCol.addEventListener("click", function() {
          let colHeader = this.closest("table").querySelector("tr").children[i + 1].querySelector("p");
          colHeader.classList.add("w-100");
        });

        newCol.addEventListener("blur", function() {
          let colHeader = this.closest("table").querySelector("tr").children[i + 1].querySelector("p");
          colHeader.classList.remove("w-100");
        });

        colHolder.appendChild(newCol);
        newRow.appendChild(colHolder);
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
    let meta = await ipc.invoke("new-row-meta", activeTable);

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
    if (id("page-next").classList.contains("invisible")) {
      id("page-next").classList.remove("invisible");
    }

    if (id("search-table").value.trim().length > 0) {
      searchForQuery(pageViewing)
    } else {
      openTableView(id("table-name").value);
    }

    if (pageViewing === 0) {
      id("page-back").classList.add("invisible");
    }

    responsiveDataViewColumns(qs("#table-view table"));
  }

  function nextPage() {
    pageViewing += 1;
    if (id("search-table").value.trim().length > 0) {
      searchForQuery(pageViewing)
    } else {
      openTableView(id("table-name").value);
    }

    if (id("page-back").classList.contains("invisible")) {
      id("page-back").classList.remove("invisible");
    }

    responsiveDataViewColumns(qs("#table-view table"));
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
    try {
      let res = await ipc.invoke("close-db-connection");
      if (res.type === "error") {
        throw new Error(res.err)
      }

      id("table-schema-view").innerHTML = "";

    } catch (err) {
      handleError(err);
    }
    // alert("NOOO! I HAVEN'T IMPLEMENT THIS YET")
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
          ipc.once("edits-complete", async () => {
            await populateDbView();
            await populateDataViewerOptions();
          });
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
      qs("#table-view > p")?.remove();

      if (tables.length === 0) {
        let msg = document.createElement("p");
        msg.textContent = "There's no tables in this database!";

        qs("#table-view > table").classList.add("hidden");
        id("table-view").appendChild(msg);
      } else {
        // Populate table options
        [...tables].forEach((table) => {
          let tableOption = document.createElement("option");
          tableOption.value = table;
          tableOption.textContent = table;

          id("table-name").appendChild(tableOption);
        });

        // populate table view as first table
        await openTableView(tables[0]);

        id("select-all").textContent = "Select All Rows";
        id("select-all").classList.remove("selected");
      }
    } catch (err) {
      alert(err);
    }
  }

  async function openTableView(table) {
    try {
      // id("page-next").classList.add("invisible");
      // id("page-back").classList.add("invisible");
      id("search-table").value = "";

      let tableData = await getDataFromTable(table);
      let tableMeta = await ipc.invoke("get-table-meta", table);

      let dataViewTable = document.createElement("table");
      let header = document.createElement("tr");

      ["Select", ...tableData.columns.map((col) => col.name)].forEach((column) => {
        let columnName = document.createElement("th");
        let columnHolder = document.createElement("p");

        columnHolder.textContent = column;

        if (column == tableMeta.pk) {
          columnName.id = "pk";
        }
        
        columnName.appendChild(columnHolder);
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
          if (selectedRows.includes(rowData[tableMeta.pk] + "")) {
            checkBox.checked = true;
          }
          checkBox.addEventListener("click", recordCheck)
  
          firstCol.appendChild(checkBox);
          row.appendChild(firstCol);
          row.id = rowData[tableMeta.pk];
  
          [...Object.keys(rowData)].forEach((col, i) => {
            let tableWidth = qs("main > section")?.offsetWidth - 25;
            let numColumns = Object.keys(rowData).length;
            let cell = document.createElement("td");
            let cellcontainer = document.createElement("p");

            cellcontainer.contentEditable = true;
            cellcontainer.textContent = rowData[col];
            // cellcontainer.style.maxWidth = `${tableWidth / numColumns}px`;
            cellcontainer.style.maxWidth = `${tableWidth / numColumns}px`;

            cellcontainer.addEventListener("input", function() {
              this.closest("tr").classList.add("modified");
              qs("a[href='#viewer']").classList.add("unsaved");

              editingRows[id("table-name").value] = editingRows[id("table-name").value] || {};
              editingRows[id("table-name").value][this.closest("tr")["id"]] = getRowContents(this.closest("tr"));
            });

            cellcontainer.addEventListener("click", function() {
              let colHeader = this.closest("table").querySelector("tr").children[i + 1].querySelector("p");
              colHeader.classList.add("w-100");
            });
    
            cellcontainer.addEventListener("blur", function() {
              let colHeader = this.closest("table").querySelector("tr").children[i + 1].querySelector("p");
              colHeader.classList.remove("w-100");
            });

            cell.appendChild(cellcontainer);
            row.appendChild(cell);
          });
          dataViewTable.appendChild(row);
        });
        
        id("table-view").appendChild(dataViewTable);
        // responsiveDataViewColumns(qs("#table-view table"));

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

      responsiveDataViewColumns(qs("#table-view table"));

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

        connectionFrame.addEventListener("click", async function() {
          await openDatabase(conn);
          // become first item
          // id("recent-connections").insertBefore(this, id("recent-connections").firstChild);
        })

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
    let closeIcon = document.createElement("img");
    closeIcon.src = "./images/close-thin.svg";
    closeIcon.classList.add("remove-connection");

    closeIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      removePreviousConnection(e);
    });

    let filename = conn.split('/');
    filename = filename[filename.length - 1];

    loc.textContent = conn;
    title.textContent = filename;
    icon.src = "./images/star-four-points.svg";
    icon.alt = "four-pointed star";

    meta.append(title, loc);
    connectionFrame.append(icon, meta, closeIcon);

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

  function handleError(err) {
    alert(err)
  }
})();