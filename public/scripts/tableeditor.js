/**
 * @author Marina Wooden
 * @date 09/14/2023
 * This is a lovely script that controls the table editor for
 * existing tables in a db.  It handles behavior including updating a
 * primary key, renaming columns and tables, editing constraints,
 * and adding columns to a table.
 */
"use strict";
(function() { 
  const SQLITE_TYPES = ["INTEGER", "REAL", "TEXT", "BLOB"];
  const ipc = require('electron').ipcRenderer;

  let hasChanges = false;
  
  window.addEventListener("load", init);

  /**
   * Page load functions
   */
  function init() {
    // get database creation query, build creation query
    fillTableInfo();

    // update primary key functionality
    id("pk").addEventListener("change", newPk);

    // add new row functionality
    id("add-row").addEventListener("click", () => {
      buildRow(true);
    });

    // Save changes function
    id("update-table").addEventListener("click", (e) => {
      e.preventDefault();
      saveNewChanges();
    });
    window.addEventListener("keydown", async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        await saveNewChanges();
      }
    });
  }

  /**
   * Updates the page in the case that the client chooses a new
   * primary key
   */
  function newPk() {
    let newPkRow = qs(`[data-name='${id("pk").value}']`);
    let oldPkRow = qs(".primary-key");
  
    oldPkRow.classList.remove("primary-key");
    oldPkRow.querySelector(".ai").checked = false;
    oldPkRow.querySelector(".ai").disabled = true;

    newPkRow.classList.add("primary-key");
    newPkRow.querySelector(".ai").disabled = false;
  }

  /**
   * Saves new changes to the table
   */
  async function saveNewChanges() {
    try {
      if (!hasChanges) {
        noNewChanges();
      } else {
        let qry = await ipc.invoke("update-table", getNewColumnMeta(), getRenameInfo());
        if (qry.type === "err") {
          throw new Error(qry.err);
        }

        qsa(".new-col").forEach((col) => {
          col.dataset.name = col.querySelector(".col-name").textContent;
          col.querySelector(".col-name > p").addEventListener("input", () => {
            col.classList.add("new-name");
            hasChanges = true;
          });
          col.classList.remove("new-col")
        });

        hasChanges = false;
      }
    } catch (err) {
      handleError(err);
    }
  }

  /**
   * Processes renamed columns that exist in a table, prepares them to be
   * included in a query
   * @returns processed column names
   */
  function getRenameInfo() {
    // when renaming, add a ".new-name" class (only to columns that have already been saved/exist in the table)
    // select all .new-name
    let renamedCols = qsa(".new-name");
    return [...renamedCols].map((col) => {
      let nameHolder = col.querySelector(".col-name");
      // [[oldname, newname]]
      return [col.dataset.name, nameHolder.textContent]
    });
  }

  /**
   * Retrieves and formats information about newly created columns
   * @returns formatted information abotu newly created columns
   */
  function getNewColumnMeta() {
    let newColumns = qsa(".new-col");
    return [...newColumns].map((col) => {
      let def = `${col.querySelector("select").value} ${col.querySelector(".nn").checked ? "NOT NULL" : ""} ${col.querySelector(".u").checked ? "UNIQUE" : ""}`.trim();
      return [col.querySelector(".col-name").textContent, def];
    });
  }

  /** Displays a brief popup indicating there are no new changes to the page */
  function noNewChanges() {
    let popup = document.createElement("div");
    popup.id = "changes-popup";
    popup.classList.add("none")
    popup.textContent = "No New Changes!";

    id("update-table").appendChild(popup);

    setTimeout(() => {
      popup.remove();
    }, 2000);
  }

  /**
   * Fills the editor screen with existing information about the current table
   */
  async function fillTableInfo() {
    try {
      let meta = await getTableMeta();
      let columnInfo = await getTableColumns();

      console.log(columnInfo);

      id("create-table-query").textContent = meta.sql;
      id("table-name").value = meta.name;

      buildColumnOptions(columnInfo);

    } catch (err) {
      handleError(err.message);
    }
  }

  /**
   * Creates all options related to columns in the table
   * @param {Object} columns - stores information about the columns
   * in a table
   */
  function buildColumnOptions(columns) {
    buildPkSelection(columns);

    for (const column of columns.columns) {
      buildRow(false, column, columns.pk === column, columns.isAutoincrement);
    }
  }

  /**
   * Creates a dropdown from which the user can select a primary key for their
   * table
   * @param {Object} columns - stores information about the columns
   * in a table
   */
  function buildPkSelection(columns) {
    let colnames = columns.columns;
    let pk = columns.pk;

    for (const column of colnames) {
      let optn = document.createElement("option");
      optn.value = column;
      optn.textContent = column;

      if (column === pk) {
        optn.selected = true;
      }

      id("pk").appendChild(optn);
    }
  }

  /**
   * Creates a row from which the client can select constraints for the specified
   * column
   * @param {Boolean} isNew - whether or not the column exists in the table
   * @param {String} column - name of the column
   * @param {Boolean} pk - whether or not the current column is the primary key
   * @param {Boolean} ai - whether or not the current table autoincrements
   */
  function buildRow(isNew = true, column, pk = false, ai = false) {
    column = column || `Column ${qsa("#row-builder tr").length}`;

    let row = document.createElement("tr");
    row.dataset.name = column;

    let nameHolder = document.createElement("td");
    let name = document.createElement("p");
    name.textContent = column;
    name.contentEditable = true;
    nameHolder.appendChild(name);
    nameHolder.classList.add("col-name");

    let typeHolder = document.createElement("td");
    let typeDropdown = document.createElement("select");
    SQLITE_TYPES.forEach((type) => {
      let optn = document.createElement("option");
      optn.value = type;
      optn.textContent = type;

      typeDropdown.appendChild(optn);
    });
    typeHolder.appendChild(typeDropdown);
    
    row.append(
      closeButton(),
      nameHolder,
      typeHolder,
      checkBox("nn", pk, ai),
      checkBox("ai", pk, ai),
      checkBox("u", pk, ai),
      checkBox("fk", pk, ai)
    );

    if (pk) {
      row.classList.add("primary-key")
    }

    if (isNew) {
      row.classList.add("new-col")
      hasChanges = true;
    } else {
      // add a class if the row refers to a column that actually exists
      // in the database
      name.addEventListener("input", function () {
        this.closest("tr").classList.add("new-name");
        hasChanges = true;
      });
    }
    
    qs("#row-builder tbody").appendChild(row)
  }

  /**
   * Factored out code for creating a checkbox input
   * @param {String} nme - identifier for the attribute that the checkbox controls
   * (such as u for unique, etc.)
   * @param {Boolean} pk - whether or not the current column is the primary key
   * @param {Boolean} ai - whether or not the current primary key autoincrements
   * @returns A checkbox input
   */
  function checkBox(nme, pk, ai) {
    let checkboxHolder = document.createElement("td");
    let checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add(nme);
    checkbox.name = `row-${qsa("#row-builder tr").length}-${nme}`;

    checkboxHolder.appendChild(checkbox);

    if (nme === "ai" && !pk) {
      checkbox.disabled = true;
    } else if (ai) {
      checkbox.checked = true;
    }
    return checkboxHolder;
  }


  /**
   * Factored code that creates a close button- which removes a column
   * from a table
   * @returns A close button
   */
  function closeButton() {
    let closeHolder = document.createElement("td");
    let closeButton = document.createElement("button");
    let closeIcon = document.createElement("img");
    closeIcon.src = "./images/close.svg";
    closeIcon.alt = "Close button";
    closeButton.classList.add("remove-row");

    closeButton.addEventListener("click", deleteColFromTable);

    closeButton.appendChild(closeIcon);
    closeHolder.appendChild(closeButton);

    return closeHolder;
  }

  /**
   * Deletes a column from a table
   */
  async function deleteColFromTable() {
    try {
      let colname = this.closest("tr").dataset.name;
      alert(`Are you sure you want to delete the column "${colname}"? (This will remove all data stored in this column!)`);

      if (this.closest("tr").classList.contains("new-col")) {
        this.closest("tr").remove()
      } else {
        // delete from table for real
      }
      // await ipc.invoke("delete-col", colname);
    } catch (err) {
      handleError(err);
    }
  }

  /**
   * Retrieves information columns in a table.
   * @returns table metadata
   */
  async function getTableColumns() {
    let res = await ipc.invoke("new-row-meta");
    return res
  }

  /**
   * Retrieves information about a table.
   * @returns table metadata
   */
  async function getTableMeta() {
    let res = await ipc.invoke("get-table-meta");
    return res;
  }

  /** HELPER FUNCTIONS THAT I PROBABLY SHOULD HAVE IMPORTED.  YOLO */
  /**
   * Shorthand for document.querySelectorAll()
   * @param {String} query - query to match
   * @returns selected DOM nodes
   */
  function qsa(query) {
    return document.querySelectorAll(query);
  }

  /**
   * Shorthand for document.querySelector()
   * @param {String} query - query to match
   * @returns selected DOM nodes
   */
  function qs(query) {
    return document.querySelector(query);
  }

  /**
   * Shorthand for document.getElementById()
   * @param {String} id - id to match
   * @returns selected DOM nodes
   */
  function id(id) {
    return document.getElementById(id);
  }

  /**
   * Displays an error message on the page
   * @param {String} message - the message to display
   */
  function handleError(message) {
    alert(message);
  }
})();