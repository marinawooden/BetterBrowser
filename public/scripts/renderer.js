"use strict";
(function() {
  const ipc = require('electron').ipcRenderer;
  const { webFrame } = require('electron');

  const MSG_LOOKUP = {
    "FOREIGN_KEY": "Invalid foreign key",
    "UNIQUE": "Non unique value in unique column",
    "TYPE_MISMATCH": "Unexpected data type"
  }
  
  let selectedRows = [];
  let pageViewing = 0;
  let sortingCol;

  window.addEventListener("load", init);

  function init() {
    webFrame.setZoomFactor(1)

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
      id("data-options").classList.add("collapsed");
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

      id("data-options").classList.add("collapsed");
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

  function loadingScreen() {
    id("loading-overlay")?.remove();

    let overlay = document.createElement("div");
    overlay.id = "loading-overlay";

    let loaderIcon = document.createElement("img");
    loaderIcon.src = "images/logo.svg";
    loaderIcon.alt = "A spinning start";

    overlay.appendChild(loaderIcon);
    qs("body").appendChild(overlay);
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

      if (!qs("#recent-connections *")) {
        let noRecentConnection = document.createElement("p");
        noRecentConnection.textContent = "Databases you connect to will be shown here";

        id("recent-connections").appendChild(noRecentConnection)
      }
    } catch (err) {
      handleError(err);
    }
  }

  function closeDataView() {
    id("table-name").innerHTML = "";
    qs(".table-no-data-footer")?.remove();
    qs("#table-view table")?.remove();
  }

  async function searchForQuery(page = 0, sortByCol, order) {
    try {
      let colnames = [...qsa("#table-view th:not(:first-of-type)")].map((elem) => elem.textContent);
      let tablename = id("table-name").value;
      let searchterm = id("search-table").value;

      let res = await ipc.invoke("search-table", tablename, colnames, searchterm, page, sortByCol, order);
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
      
      [...Object.keys(result)].forEach((col, i) => {
        let content = document.createElement("td");
        let contentHolder = document.createElement("p")

        contentHolder.contentEditable = true;
        contentHolder.textContent = result[col];
        contentHolder.addEventListener("input", saveDataViewerInput);

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
    let tableWidth = table?.parentNode?.offsetWidth - 300;
    let numColumns = table?.querySelectorAll("th").length - 1;

    let content = table?.querySelectorAll("tr td:not(:first-of-type) p");

    if (content) {
      [...content].forEach((elem) => {
        elem.style.maxWidth = `${(tableWidth / numColumns)}px`;
        elem.style.minWidth = `${(tableWidth / numColumns)}px`;
      });
    }
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
      qs("#database-structure ul div:not(.collapsed)")?.classList.add("collapsed");
      popup.remove();
    });
    
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
      handleError(err);
    }
  }

  function getNewColumnValues() {
    return [...qsa(".new-row")].map((row) => {
      let cells = [...row.querySelectorAll("td")];
      cells.shift();  
    
      return cells.map((cell) => {
        return cell.textContent;
      })
    });
  }

  function getColumnNames() {
    let columns = [...qsa("#table-view table th")];
    columns.shift();

    return columns.map((col) => {
      return col.textContent
    });
  }

  async function saveNewChanges() {
    try {
      let viewingTable = id("table-name").value;
      let columnValues = getNewColumnValues();
      let res;

      if (columnValues.length > 0) {
        res = await ipc.invoke("add-new-rows", viewingTable, getNewColumnValues(), getColumnNames(), force);
        if (res.type === "err") {
          if (res.detail === "SQLITE_CONSTRAINT") {
            throw new Error("Please resolve all foreign key conflicts before saving!");
          } else {
            throw new Error(res.error);
          }
        }

        [...qsa(".new-row")].forEach((row) => {
          row.classList.remove("new-row")
          row.querySelectorAll("p").forEach((inpt) => {
            // TODO: NEW ROWS
            inpt.addEventListener("input", saveDataViewerInput)
          });
        });
      }

      if (qsa(".invalid-row").length > 0) {
        throw new Error("Please resolve all errors before saving!")
      }

      res = await ipc.invoke("commit-dataview-changes", viewingTable);

      if (res.type === "err") {
        throw new Error(res.error);
      }

      qs(".unsaved")?.classList.remove("unsaved");
      await populateDbView();
      id("data-options").classList.add("collapsed");

    } catch (err) {
      if (!/cannot rollback/g.test(err.message)) {
        handleError(err);
      }
    }
  }

  function insertAfter(newNode, existingNode) {
    existingNode.parentNode.insertBefore(newNode, existingNode.nextSibling);
  }

  async function addNewRow() {
    try {
      let res = await ipc.invoke("add-empty-row", id("table-name").value);
      if (res.type === "err") {
        throw new Error(res.error);
      }

      qs("#table-view .table-no-data-footer")?.remove();

      let row = document.createElement("tr");
      console.log(res);

      row.id = res.result[res.pk];
      let fkviolations = res.fkconflicts?.map((e) => e.rowid + e.col);

      console.log(res);
      console.log(fkviolations);

      ["", ...Object.keys(res.result)].forEach((col, i) => {
        let cell = document.createElement("td");
        if (i === 0) {
          let checkboxHolder = document.createElement("div");
          let checkbox = document.createElement("input");
          checkbox.type = "checkbox";

          checkboxHolder.classList.add("select-check")
          checkboxHolder.appendChild(checkbox);
          cell.appendChild(checkboxHolder);
        } else {
          let content = document.createElement("p");
          content.addEventListener("input", saveDataViewerInput);
          content.textContent = res.result[col];
          content.contentEditable = true;
          
          if (fkviolations?.includes(res.result[res.pk] + col)) {
            makeInvalid(content)
          }

          cell.prepend(content);
        }
        row.appendChild(cell);
      });

      if (qsa("#table-view tr").length === 11) {
        qs("#table-view tr:last-of-type").remove();
        id("page-next").classList.remove("invisible");
      }
      
      insertAfter(row, qs("#table-view tr"));
      
      responsiveDataViewColumns(qs("#table-view table"));
      id("data-options").classList.add("collapsed");
      qs("a[href='#viewer']").classList.add("unsaved");
    } catch (err) {
      handleError(err);
    }
  }

  function ensureInFrame(evt) {
    // console.log(this.getBoundingClientRect());
    const vw = qs("body").getBoundingClientRect();
    const pos = this.getBoundingClientRect();

    // right overflow
    console.log(pos.width + pos.x + 50);
    console.log(vw);

    if ((pos.width + pos.x + 50) > vw.width) {
      let clip = vw.width - (pos.width + pos.x);
      console.log(clip);
      this.parentNode.querySelector("div").style.marginLeft = `-${clip}px`;
      this.classList.add("overflowed");
    }
  }

  function resetFrame() {
    this.classList.remove("overflowed");
  }

  function makeInvalid(content, message = "FOREIGN_KEY", parent) {
    parent = parent || content.parentNode;
    content.classList.add("invalid-row");
    let msgElem = document.createElement("div");
    msgElem.textContent = MSG_LOOKUP[message];

    content.addEventListener("mouseover", ensureInFrame);
    content.addEventListener("mouseleave", resetFrame);

    parent.appendChild(msgElem);
  }

  function validateRow(cell) {
    cell.classList.remove("invalid-row");
    cell.parentNode.querySelector("div")?.remove();

    cell.removeEventListener("mouseover", makeInvalid);
  }

  async function saveDataViewerInput(e) {
    try {
      qs("a[href='#viewer']").classList.add("unsaved");
      let table = id("table-name").value;
      let value = e.target.textContent;
      let pk = id("pk").textContent;
      let pkValue = e.target.closest('tr').id;
      let modifiedColumn = qs("#table-view table tr").children[[...e.target.closest("tr").children].indexOf(e.target.parentNode)];

      if (e.target.textContent.trim().length > 0) {
        let res = await ipc.invoke("add-dataview-changes", table, modifiedColumn.textContent, value, pk, pkValue);
        e.target.parentNode.querySelector("div")?.remove();

        // PROBLEM: IF there's an error in some other column, the commented
        // implementation will highlight the current column as well- even if
        // it's not the one causing the issue
        console.log(res);
        if (res.type === "err" && res.error !== "too fast") {
          
          let violatingIds = res.violations?.map((row) => row.rowid + row.from);
          if (res.detail === "FOREIGN_KEY") {
            let colName = qs("#table-view tr").children[[...e.target.closest("tr").children].indexOf(e.target.parentNode)].textContent;
            console.log(e.target.closest("tr").id + colName);
            if (violatingIds.includes(e.target.closest("tr").id + colName)) {
              // foreign key violation
              makeInvalid(e.target)
            } else {
              validateRow(e.target)
            }
          } else {
            makeInvalid(e.target, res.detail)
          }
        } else {
          if (modifiedColumn.id === "pk") {
            e.target.closest("tr").id = value;
          }
          validateRow(e.target);
          qs("a[href='#viewer']").classList.add("unsaved");
        }
      }
    } catch (err) {
      handleError(err);
    }
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
      if (rowIds.length > 10) {
        await openTableView(activeTable);
      }
      
      rows.forEach((row) => {
        row.closest("tr").remove();
      });

      id("data-options").classList.add("collapsed");
    } catch (err) {
      handleError(err);
    }
  }
  

  async function sendRowsToDeletion(rows, table) {
    let res = await ipc.invoke("remove-rows", rows, table);
    if (res.type === "error") {
      throw new Error(res.err)
    }

    qs("a[href='#viewer']").classList.add("unsaved");
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
      // searchForQuery(pageViewing)

      let order = id("table-view").classList.contains("sorted");

      if (order) {
        searchForQuery(pageViewing, sortingCol, order ? "DESC" : "ASC")
      } else {
        searchForQuery(pageViewing)
      }
    } else {
      let order = id("table-view").classList.contains("sorted") ? "DESC" : "ASC";
      openTableView(id("table-name").value, sortingCol, order);
    }

    if (pageViewing === 0) {
      id("page-back").classList.add("invisible");
    }

    responsiveDataViewColumns(qs("#table-view table"));
    id("data-options").classList.add("collapsed");
  }

  function nextPage() {
    pageViewing += 1;
    if (id("search-table").value.trim().length > 0) {
      let order = id("table-view").classList.contains("sorted");
      if (order) {
        searchForQuery(pageViewing, sortingCol, order ? "DESC" : "ASC")
      } else {
        searchForQuery(pageViewing)
      }
      
    } else {
      let order = id("table-view").classList.contains("sorted") ? "DESC" : "ASC";
      openTableView(id("table-name").value, sortingCol, order);
    }

    if (id("page-back").classList.contains("invisible")) {
      id("page-back").classList.remove("invisible");
    }

    responsiveDataViewColumns(qs("#table-view table"));
    id("data-options").classList.add("collapsed");
  }

  async function executeSql() {
    let sql = id("sql-input").value;
    if (sql.trim()) {
      try {
        loadingScreen();
        let res = await ipc.invoke("execute-sql", sql);

        id("loading-overlay")?.remove();
        id("query-details").innerHTML = "";
        id("table-limiter").innerHTML = "";

        if (res.type === "error") {
          throw new Error(res.err)
        }

        id("query-details").classList.remove("query-error")
        
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
        executorError(err);
      }
    } else {
      betterPopup("Please enter a SQL query!", "No SQL query was entered")
    }
  }

  function executorError(err) {
    id("query-details").innerHTML = "";
    id("table-limiter").innerHTML = "";

    id("query-details").classList.add("query-error");

    let errorMessage = document.createElement("p");
    errorMessage.textContent = err.message;
    id("query-details").appendChild(errorMessage);
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
      closeDataView()
    } catch (err) {
      handleError(err);
    }
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
            // Not sure why but it say's there's no table 'contact' when I rename
            await populateDataViewerOptions();
            await populateDbView();
          });
        } catch (err) {
          handleError(err);
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
      id("add-table-options").classList.toggle("hidden");
    });

    let addTableOptions = document.createElement("div");
    let fromCSV = document.createElement("p");
    let manual = document.createElement("p");

    addTableOptions.id = "add-table-options";
    addTableOptions.classList.add("hidden");

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
      handleError(err);
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
      handleError(err);
    }
  }

  async function getTables() {
    try {
      let tables = await ipc.invoke('retrieve-tables');

      if (tables.type === "err") {
        throw new Error(tables.error)
      }

      console.log(tables);
      return {
        "db": tables["db"],
        "tables": tables["tables"].filter((table) => table.tbl !== "sqlite_sequence")
      };
    } catch (err) {
      handleError(err);
    }
  }

  async function getDataFromTable(table, orderBy, direction) {
    try {
      let tableData = await ipc.invoke('view-data', table, pageViewing, orderBy, direction);
      if (tableData.type === "err") {
        throw new Error(tableData.error);
      }

      return tableData;
    } catch (err) {
      handleError(err);
    }
  }

  async function openDatabase(dbPath = "") {
    try {
      let currentDb = await (async () => {
        let res = ipc.invoke('open-database', dbPath);
        ipc.once("creating-database", () => {
          console.log("IS CREATING DATABASe");
          loadingScreen();
        });

        return res
      })();
      
      console.log(currentDb);

      if (currentDb.type === "err") {
        throw new Error(currentDb.err);
      } else if (currentDb.type === "success") {
        setCurrentDbName(currentDb["res"]);
        await getRecentConnections();
        await populateDbView();
        await populateDataViewerOptions();
      }

      id("loading-overlay")?.remove();
    } catch (err) {
      id("loading-overlay")?.remove();
      handleError(err);
    }
  }

  function setCurrentDbName(dbPath) {
    let filename = dbPath.split('/');
    filename = filename[filename.length - 1];
  
    qsa(".current-db-name").forEach((node) => node.textContent = filename)
  }

  async function promptForClear() {
    let clearConfirm = await betterConfirm("Are you sure you want to clear your recent database connections?");
    if (clearConfirm) {
      clearConnections();
    }

    id("there-she-goes").remove();
  }

  function betterConfirm(text) {
    let confirmOption = document.createElement("dialog");
    let confirmText = document.createElement("p");
    confirmText.textContent = text;

    confirmOption.id = "there-she-goes";

    let buttonHolder = document.createElement("div");
    let yesButton = document.createElement("button");
    let noButton = document.createElement("button");

    yesButton.textContent = "Yes";
    noButton.textContent = "No";

    buttonHolder.classList.add("buttonholder");
    yesButton.classList.add("yes");
    noButton.classList.add("no");

    buttonHolder.append(yesButton, noButton);
    confirmOption.append(confirmText, buttonHolder);

    qs("body").appendChild(confirmOption)
    confirmOption.showModal();

    return new Promise((resolve) => {
      yesButton.addEventListener("click", () => resolve(true));
      noButton.addEventListener("click", () => {
        resolve(false)
      });
    });
  }

  async function clearConnections() {
    try {
      await ipc.invoke('clear-connections');
      id("recent-connections").innerHTML = "";
      let noConnections = document.createElement("p");
      noConnections.textContent = "Databases you connect to will be shown here";
      id("recent-connections").appendChild(noConnections);
    } catch (err) {
      handleError(err);
    }
  }

  async function getRecentConnections() {
    try {
      let res = await ipc.invoke('recent-connections');
      populateRecentConnections(res || []);
    } catch (err) {
      handleError(err);
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

        qs("#table-view > table")?.classList.add("hidden");
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
      handleError(err);
    }
  }

  async function getForeignKeyViolations(table) {
    let res = await ipc.invoke("get-fk-violations", table);

    if (res.type === "err") {
      throw new Error(res.error);
    }
    
    return res.violations.map((viol) => viol.rowid + viol.col);
  }

  async function openTableView(table, orderBy, sortDirection) {
    try {
      id("search-table").value = "";

      let tableData = await getDataFromTable(table, orderBy, sortDirection);
      console.log(tableData);
      // todo: use this info to apply the invalid row class to new stuff
      let foreignKeyViolations = await getForeignKeyViolations(table);
      let tableMeta = await ipc.invoke("get-table-meta", table);

      if (!tableMeta.type === "err") {
        throw new Error(tableMeta.error);
      }

      let dataViewTable = document.createElement("table");
      let header = document.createElement("tr");

      ["Select", ...tableData.columns?.map((col) => col.name)].forEach((column, i) => {
        let columnName = document.createElement("th");
        let columnHolder = document.createElement("p");

        columnHolder.textContent = column;

        if (column == tableMeta.pk) {
          columnName.id = "pk";
        }

        if (i > 0) {
          columnName.addEventListener("click", () => {
            sortingCol = column;
            let sortedOrder = qs("#table-view").classList.contains("sorted") ? "ASC" : "DESC";
            if (id("search-table").value.trim().length > 0) {
              searchForQuery(pageViewing, column, sortedOrder)
            } else {
              openTableView(id("table-name").value, column, sortedOrder);
              qs("#table-view").classList.toggle("sorted");
            }
          });
        }
        
        columnName.appendChild(columnHolder);
        header.appendChild(columnName);
        console.log(header);
      });

      dataViewTable.dataset.ai = tableMeta.isAutoincrement;
      dataViewTable.appendChild(header);

      qs("#table-view table")?.remove();
      qs("#table-view .table-no-data-footer")?.remove();

      if (tableData.data.length > 0) {
        tableData.data.forEach((rowData, i) => {
          let row = document.createElement("tr");
          let firstCol = document.createElement("td");
          let checkboxHolder = document.createElement("div");
          let checkBox = document.createElement("input");
          checkBox.type = "checkbox";
          if (selectedRows.includes(rowData[tableMeta.pk] + "")) {
            checkBox.checked = true;
          }
          checkBox.addEventListener("click", recordCheck);
          checkboxHolder.classList.add("select-check");
          checkboxHolder.appendChild(checkBox);
  
          firstCol.appendChild(checkboxHolder);
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

            if (foreignKeyViolations.includes(rowData[tableMeta.pk] + col)) {
              makeInvalid(cellcontainer, "FOREIGN_KEY", cell);
            }

            cellcontainer.addEventListener("input", saveDataViewerInput);

            cellcontainer.addEventListener("click", function() {
              let colHeader = this.closest("table").querySelector("tr").children[i + 1].querySelector("p");
              colHeader.classList.add("w-100");
            });
    
            cellcontainer.addEventListener("blur", function() {
              let colHeader = this.closest("table").querySelector("tr").children[i + 1].querySelector("p");
              colHeader.classList.remove("w-100");
            });

            cell.prepend(cellcontainer);
            row.appendChild(cell);
          });
          dataViewTable.appendChild(row);
        });

        // scrolling to load more 
        dataViewTable.addEventListener("scroll", loadMoreTuples)
        

        if (tableData.data.length % 10 !== 0) {
          id("page-next").classList.add("invisible");
        } else {
          id("page-next").classList.remove("invisible");
        }
      }
      
      if (!id("data-holder")) {
        let dataHolder = document.createElement("div");
        dataHolder.id = "data-holder";
        
        dataHolder.appendChild(dataViewTable);
        id("table-view").appendChild(dataHolder);
      } else {
        id("data-holder").appendChild(dataViewTable);
      }

      if (tableData.data.length === 0) {
        // append the column names
        let footer = document.createElement("div");
        footer.classList.add("table-no-data-footer");

        let footerText = document.createElement("p");
        footerText.textContent = "There's no data there";

        footer.appendChild(footerText);
        id("data-holder")?.append(dataViewTable, footer);
      }

      responsiveDataViewColumns(qs("#table-view table"));
    } catch (err) {
      handleError(err);
    }
  };

  function loadMoreTuples() {
    // console.log(this.)
  }

  function populateRecentConnections(connections) {
    id("recent-connections").innerHTML = "";

    if (connections.length === 0) {
      let msg = document.createElement("p");
      msg.textContent = "Databases you connect to will be shown here";

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

    loc.classList.add("text-secondary")

    closeIcon.src = "./images/close-thin.svg";
    closeIcon.classList.add("remove-connection");
    closeIcon.classList.add("dark");

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

    icon.classList.add("dark");

    meta.append(title, loc);
    connectionFrame.append(icon, meta, closeIcon);

    return connectionFrame;
  }

  async function addDatabase() {
    try {
      let currentDb = await ipc.invoke('add-database');

      console.log(currentDb);

      if (currentDb.type === "err") {
        throw new Error(currentDb.error);
      } else if (currentDb.type === "success") {
        setCurrentDbName(currentDb.result);
        await populateDbView()
        await getRecentConnections();
        // await 
        await populateDataViewerOptions();
      }
    } catch (err) {
      handleError(err);
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

      id("data-options").classList.add("collapsed");
      if (idToOpen === "viewer") {
        responsiveDataViewColumns(qs("#table-view table"));
      }
    }
  }
  

  function betterPopup(title, text, btnText = "Dismiss") {
    let popup = document.createElement("dialog");
    let tt = document.createElement("p");
    tt.classList.add("popup-title");

    let dt = document.createElement("p");
    
    tt.textContent = title;
    dt.textContent = text;

    popup.id = "disco-2000";

    let dismiss = document.createElement("button");
    dismiss.textContent = btnText;
    dismiss.addEventListener("click", () => {
      setTimeout(() => {
        popup.remove();
      }, 1000)
    });

    popup.append(tt, dt, dismiss);
    qs("body").appendChild(popup);
    popup.showModal();
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
    console.error(err);
    betterPopup("An Error Occurred :-(", err.message);
  }
})();