"use strict";
(function() {
  const ipc = require('electron').ipcRenderer;
  const { webFrame } = require('electron');
  
  let selectedRows = [];
  let violatedRows = [];
  let pageViewing = 0;
  let sortingCol;
  let prevError;

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

      // if (qs("#database-structure p")?.textContent === toRemoveName) {
      //   id("database-structure").remove();
      //   let noDatabaseOpenText = document.createElement("p");
      //   noDatabaseOpenText.textContent = "No database is currently open, please create one or open one from a file";

      //   id("table-schema-view").appendChild(noDatabaseOpenText);
      //   id("table-name").innerHTML = "";
      //   qs("#table-view table").remove();
      // }

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
      // TODO: This is redundant- should be the same as AddNewRow
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

    let content = table?.querySelectorAll("p");

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
      console.error(err);
      alert(err.message);
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
      // TODO: get table name from element
      let viewingTable = id("table-name").value;
      let columnValues = getNewColumnValues();
      let res;

      if (columnValues.length > 0) {
        res = await ipc.invoke("add-new-rows", viewingTable, getNewColumnValues(), getColumnNames(), force);
        if (res.type === "err") {
          if (res.detail === "SQLITE_CONSTRAINT") {
            // blah factor
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
      row.id = res.result[res.pk];

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

          cell.appendChild(content);
        }
        row.appendChild(cell);
      });

      if (qsa("#table-view tr").length === 11) {
        qs("#table-view tr:last-of-type").remove();
        id("page-next").classList.remove("invisible");
      }
      
      insertAfter(row, qs("#table-view tr"));
      responsiveDataViewColumns();
      id("data-options").classList.add("collapsed");
    } catch (err) {
      handleError(err);
    }
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

        let from = [...qs("#table-view tr").children][[...e.target.closest('tr').children].indexOf(e.target.parentNode)].textContent
        let tableName = id("table-name").value;
        let rowid = e.target.closest("tr").id;

        // PROBLEM: IF there's an error in some other column, the commented
        // implementation will highlight the current column as well- even if
        // it's not the one causing the issue
        if (res.type === "err" && res.error !== "too fast") {
          const MSG_LOOKUP = {
            "FOREIGN_KEY": "Invalid foreign key",
            "UNIQUE": "Non unique value in unique column"
          }

          let violations = res.violations || [{
            "from": from,
            "table": tableName,
            "rowid": rowid,
          }];

          // if it's a fk violation- find all with the same violation and if they're not in res.violations delete them!

          for (let i = 0; i < violations.length; i++) {
            let violation = violations[i];
            let key = `${violation.table}.${violation.from}.${violation.rowid}`;

            violatedRows[key] = res.detail;

            let idIndex = [...qs("#table-view table tr").children].map((e) => e.textContent).indexOf(violation.from);
            let violatedP = qs(`[id='${violation.rowid}']`).children[idIndex].querySelector("p");
            if (!violatedP.classList.contains("invalid-row")) {
              violatedP.classList.add("invalid-row");
            
              let msg = document.createElement("div");
              msg.textContent = MSG_LOOKUP[res.detail] || "Unknown Error";
              violatedP.parentNode.appendChild(msg);
            }
          }

          console.log(prevError);
        } else {
          if (modifiedColumn.id === "pk") {
            e.target.closest("tr").id = value;
          }
          // e.target.classList.remove("invalid-row");
          qs("a[href='#viewer']").classList.add("unsaved");
        }

        // if a violation existing in the record
        let key = `${table}.${from}.${rowid}`;
        console.log(key);
        if (violatedRows?.[key]) {
          console.log(violatedRows[key])
          // a violation exists, now does the current error match the previous violation?
          if (res.type !== "err" || res.detail !== violatedRows[key]) {
            // no?  Okay - we can remove the class!
            e.target.classList.remove("invalid-row");
            console.log(e.target);
            delete violatedRows[key]
          }
        }

        // if (res.detail !== prevError || res.type !== "err") {
        //   let rowNameTest = new RegExp(`\.${rowid}$`);
        //   let currRowViolations = [...Object.keys(violatedRows)].filter((row) => {
        //     return rowNameTest.test(row)
        //   });

        //   for (let i = 0; i < currRowViolations.length; i++) {
        //     for (const error of violatedRows[currRowViolations[i]]) {
        //       if (error === prevError) {
        //         violatedRows[currRowViolations[i]].delete(error);

        //         if (violatedRows[currRowViolations[i]].size === 0) {
        //           let row = currRowViolations[i].split(".")[1];
        //           let id = currRowViolations[i].split(".")[2];
        //           let idIndex = [...qs("#table-view table tr").children].map((e) => e.textContent).indexOf(row);

        //           qs(`[id='${id}']`).children[idIndex].querySelector("p").classList.remove("invalid-row");
        //         }
        //       }
        //     }
        //   }

        //   prevError = res.detail;
        // }

        console.log(violatedRows);
      }
    } catch (err) {
      handleError(err);
    }
  }

  function removeFromArray(arr, val) {
    const index = arr.indexOf(val);
    if (index > -1) { // only splice array when item is found
      arr.splice(index, 1); // 2nd parameter means remove one item only
    }

    return arr
  }

  // function highlightInvalidRows() {
  //   const errors = {
  //     "FOREIGN_KEY": "Invalid foreign key",
  //     "UNIQUE": "Non-unique value in unique column",
  //     "TYPE_MISMATCH": "This isn't the expected type for this column"
  //   }
  //   // look through each in violatedRows[table] and add there
  //   let currTableViolations = violatedRows[qs("#table-name").value];
  //   Object.keys(currTableViolations).forEach((colName) => {
  //     let violationsInCol = currTableViolations[colName];
  //     let violatingIds = violationsInCol.map((e) => e[0])
  //     let colElem = [...qsa("#table-view tr th")].find((e) => e.textContent === colName);
  //     let indexOfId = [...colElem.parentNode.children].indexOf(colElem)
  //     // let indexOfId = [...Object.keys(currTableViolations)].indexOf(colName) + 1;
  //     let violatingRowElems = qsa('[id="' + violatingIds.join('"], [id="') + '"]')

  //     violatingRowElems.forEach((rowElem, i) => {
  //       rowElem.children[indexOfId].querySelector("p").classList.add("invalid-row");
  //       let errmsg = violationsInCol[i][1];
  //       let msg = document.createElement("div");
  //       msg.textContent = errors[errmsg] || "Unknown error";
  //       rowElem.children[indexOfId].appendChild(msg);
  //       rowElem.children[indexOfId].dataset.erroredfor = errmsg;
  //     });
  //   });
  // }

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
      console.error(err);
      alert(err.message);
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
        console.error(err);
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
          console.error(err);
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
      console.error(err);
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
      console.error(err);
      alert(err);
    }
  }

  async function getTables() {
    try {
      let tables = await ipc.invoke('retrieve-tables');

      if (tables.type === "err") {
        throw new Error(tables.error)
      }

      return {
        "db": tables["db"],
        "tables": tables["tables"].filter((table) => table.tbl !== "sqlite_sequence")
      };
    } catch (err) {
      console.error(err);
      alert(err);
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
      console.error(err);
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

      if (qs("#recent-connections div")) {
        await getRecentConnections();
        await populateDataViewerOptions();
      }
    } catch (err) {
      console.error(err);
      alert(err);
    }
  }

  async function getRecentConnections() {
    try {
      let res = await ipc.invoke('recent-connections');
      populateRecentConnections(res);
    } catch (err) {
      console.error(err);
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
      console.error(err);
      alert(err);
    }
  }

  async function openTableView(table, orderBy, sortDirection) {
    try {
      id("search-table").value = "";

      let tableData = await getDataFromTable(table, orderBy, sortDirection);
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

            cellcontainer.addEventListener("input", saveDataViewerInput);

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

            // if (violatedRows[table]?.[col]?.includes(rowData[tableMeta.pk])) {
            //   cellcontainer.classList.add("invalid-row");
            //   let popup = document.createElement('div');
            //   popup.textContent = "Invalid foreign key";

            //   cell.appendChild(popup);
            // }
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
      console.error(err);
      alert(err);
    }
  };

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

      if (currentDb.type === "err") {
        throw new Error(currentDb.error);
      }

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

      id("data-options").classList.add("collapsed");
      if (idToOpen === "viewer") {
        responsiveDataViewColumns(qs("#table-view table"));
      }
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
    console.error(err);
    alert(err)
  }
})();