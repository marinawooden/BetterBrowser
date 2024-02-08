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

    // rename table functionality
    id("table-name").addEventListener("input", function() {
      this.classList.add("new-table-name");
      hasChanges = true;
    })

    // add new row functionality
    id("add-row").addEventListener("click", () => {
      buildRow(true);
      let newSelectOption = document.createElement("option");
      newSelectOption.value = `Column ${qsa("#row-builder tr").length - 1}`;
      newSelectOption.textContent = `Column ${qsa("#row-builder tr").length - 1}`;
      id("pk").appendChild(newSelectOption);

      responsiveDataViewColumns(qs("#row-builder"))
    });

    // Save changes function
    id("update-table").addEventListener("click", (e) => {
      e.preventDefault();
      saveNewChanges();
    });
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveNewChanges();
      }
    });

    window.addEventListener("resize", () => {
      responsiveDataViewColumns(qs("table"))
    });
  }

  async function getConstraints() {
    let res = await ipc.invoke("get-constraints");
    if (res.type !== "err") {
      return res;
    } else {
      throw new Error(res.err);
    }
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

    hasChanges = true;
  }

  function parseForeignKeys() {
    return [...qsa(".fk:checked")].map((input) => {
      let colName = input.closest("tr").dataset.name;
      let references = input.closest("tr").querySelector(".fk-value").value;
      let referencesTable = references.split(".")[0];
      let referencesColumn = references.split(".")[1];

      return `\nFOREIGN KEY("${colName}") REFERENCES "${referencesTable}"("${referencesColumn}")`
    });
  }

  /**
   * Saves new changes to the table
   * FOREIGN KEY("identifier") REFERENCES "Games"("identifier")
   */
  async function saveNewChanges() {
    try {
      if (!hasChanges) {
        changesPopup(false);
      } else {
        let newColNames = [...qsa(".col-name")].map((col) => `"${col.textContent}"`);
        let defaults = [...qsa(".def")].map((def) => def.value);
        
        let qry = await ipc.invoke("update-table", creationStmt(), id("table-name").value, newColNames.reverse(), defaults);
        if (qry.type === "err") {
          throw new Error(qry.err);
        }

        [...qsa(".new-col")].forEach((col) => {
          col.dataset.name = col.querySelector(".col-name").textContent;
          col.querySelector(".col-name > p").addEventListener("input", () => {
            col.classList.add("new-name");
            hasChanges = true;
          });
          col.classList.remove("new-col");
        });

        qs("new-table-name")?.classList.remove("new-table-name");
        hasChanges = false;

        changesPopup(true);
      }
    } catch (err) {
      handleError(err);
    }
  }

  function creationStmt() {
    try {
      let columnMeta = getNewColumnMeta();
      let columnNames = [...columnMeta].map((col) => {
        return `\n"${col[0]}" ${col[1]}`
      });
      let primaryKey = `\nPRIMARY KEY ("${id('pk').value}"${qs("tr[data-name='" + id('pk').value + "'] .ai")?.checked ? " AUTOINCREMENT" : ""}`;
      let foreignKeys = parseForeignKeys()

  //     "rating"	INTEGER NOT NULL DEFAULT 1,
	// FOREIGN KEY("identifier") REFERENCES "Games",
	// PRIMARY KEY("identifier" AUTOINCREMENT)
      let query = `
        ${columnNames},${foreignKeys.length > 0 ? foreignKeys + "," : ""}${primaryKey})
      `.trim();

      return query;
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
    let columns = [...qsa("#row-builder tr")];
    columns.shift();

    const DEFAULTS = {
      "INTEGER": -1,
      "REAL": -1.0,
      "TEXT": "-",
      "BLOB": "-",
    }

    
    return [...columns].map((col) => {
      let defaultValue = col.querySelector(".def").value;

      if (col.querySelector(".nn").checked && !col.querySelector(".def").value) {
        defaultValue = DEFAULTS[col.querySelector("select").value]
      };

      let def = `${col.querySelector("select").value} ${col.querySelector(".nn").checked ? "NOT NULL" : ""} ${col.querySelector(".u").checked ? "UNIQUE" : ""} ${defaultValue ? `DEFAULT "${defaultValue}"` : ""}`.trim();
      return [col.querySelector(".col-name").textContent, def];
    });
  }

  /** Displays a brief popup indicating there are no new changes to the page */
  function changesPopup(hasChanges) {
    let popup = document.createElement("div");
    popup.id = "changes-popup";
    popup.classList.add(!hasChanges ? "none" : "green")
    popup.textContent = !hasChanges ? "No New Changes!" : "Saved Changes";

    id("update-table").appendChild(popup);

    setTimeout(() => {
      popup.remove();
    }, 2000);
  }

  async function getForeignKeys() {
    let res = await ipc.invoke("get-foreign-keys");
    if (res.type === "err") {
      throw new Error(res.error);
    }

    return res
  }

  /**
   * Fills the editor screen with existing information about the current table
   */
  async function fillTableInfo() {
    try {
      let meta = await getTableMeta();
      let columnInfo = await getTableColumns();
      let constraints = await getConstraints();
      let foreignKeys = await getForeignKeys();

      id("table-name").value = meta.name;

      buildColumnOptions(columnInfo, constraints["results"], foreignKeys["results"], meta.isAutoincrement);
      responsiveDataViewColumns(qs("table"));
    } catch (err) {
      handleError(err);
    }
  }

  /**
   * Creates all options related to columns in the table
   * @param {Object} columns - stores information about the columns
   * in a table
   */
  function buildColumnOptions(columns, constraints, foreignKeys, isAutoincrement) {
    buildPkSelection(columns);

    columns.columns.forEach((column, i) => {
      buildRow(false, constraints[i], columns.types[i], column, columns.pk === column, isAutoincrement && columns.pk === column, foreignKeys[column]);
    })
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
  function buildRow(isNew = true, constraints, colType, column, pk = false, ai = false, foreignKey) {
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
    typeDropdown.addEventListener("change", () => {hasChanges = true});

    SQLITE_TYPES.forEach((type) => {
      let optn = document.createElement("option");
      optn.value = type;
      optn.textContent = type;

      if (type === colType) {
        optn.selected = true;
      }

      typeDropdown.appendChild(optn);
    });

    if (!SQLITE_TYPES.includes(colType)) {
      typeDropdown.querySelector("option[value='BLOB']").selected = true;
    }

    typeHolder.appendChild(typeDropdown);

    let defaultHolder = document.createElement("td");
    let defaultInput = document.createElement("input");
    defaultInput.classList.add("def");
    defaultInput.name = `row-${qsa("#row-builder tr").length}-default`;
    defaultInput.type = "text";
    defaultHolder.appendChild(defaultInput);
    defaultInput.value = constraints?.default?.replace(/['"]+/g, '') || "";

    defaultInput.addEventListener("input", () => {
      hasChanges = true
    })

    let fk = checkBox("fk", pk, ai);
    let fkInputHolder = document.createElement("td");
    let fkInput = document.createElement("select");
    fkInput.id = `row-${qsa("#row-builder tr").length}-fk-value`;
    fkInput.value = `fk-${qsa("#row-builder tr").length}-value`;
    fkInput.classList.add(`fk-value`);
    fkInput.classList.add("hidden")

    fkInput.addEventListener("change", () => hasChanges = true)

    if (foreignKey) {
      fk.querySelector("input").checked = true;
      fkInput.classList.remove("hidden");
      id("fk-header").classList.remove("hidden");
    }

    // populate with columns from all other tables
    populateWithOtherColumns(fkInput, foreignKey);

    fk.querySelector("input").addEventListener("click", () => {
      if (fk.querySelector("input").checked) {
        id("fk-header").classList.remove("hidden");
      } else if (qsa(".fk:checked").length === 0) {
        id("fk-header").classList.add("hidden");
      }
      fkInput.classList.toggle("hidden");
    });

    fkInputHolder.appendChild(fkInput);
    
    row.append(
      closeButton(column),
      nameHolder,
      typeHolder,
      checkBox("nn", pk, ai, constraints?.nn),
      checkBox("ai", pk, ai),
      checkBox("u", pk, ai, constraints?.u),
      fk,
      defaultHolder,
      fkInputHolder
    );

    if (pk) {
      row.classList.add("primary-key")
    }

    if (isNew) {
      hasChanges = true;
    }

    name.addEventListener("input", function () {
      updateSelectionName(this);
      this.closest("tr").classList.add("new-name");
      hasChanges = true;
    });
    
    if (qs("#row-builder tbody tr")) {
      qs("#row-builder tbody tr").parentNode.insertBefore(row, qs("#row-builder tbody tr").nextSibling);
    } else {
      qs("#row-builder tbody").appendChild(row)
    }
  }

  async function populateWithOtherColumns(input, foreignKey) {
    try {
      let res = await ipc.invoke("get-other-columns", true);
      if (res.type === "err") {
        throw new Error(res.error);
      }

      let groups = Object.keys(res.results);
      groups.forEach((group) => {
        let optgroup = document.createElement("optgroup");
        optgroup.label = group;
        res.results[group].forEach((val) => {
          let opt = document.createElement("option");
          opt.value = `${group}.${val}`;
          opt.textContent = val;

          if (opt.value === foreignKey) {
            opt.selected = true;
          }

          optgroup.appendChild(opt);
        });
        input.appendChild(optgroup);
      });
    } catch (err) {
      handleError(err);
    }
  }

  /**
   * A node 
   * @param {HTMLElement} elem - the editing node
   */
  function updateSelectionName(elem) {
    let newName = elem.textContent;
    let rows = [...elem.closest("tr").parentNode.querySelectorAll("tr")];
    let toChangeIndex = rows.length - rows.indexOf(elem.closest("tr")) - 1;

    ;

    id("pk").children[toChangeIndex].textContent = newName;
    id("pk").children[toChangeIndex].value = newName;
    
    elem.closest("tr").dataset.name = newName;
  }

  /**
   * Factored out code for creating a checkbox input
   * @param {String} nme - identifier for the attribute that the checkbox controls
   * (such as u for unique, etc.)
   * @param {Boolean} pk - whether or not the current column is the primary key
   * @param {Boolean} ai - whether or not the current primary key autoincrements
   * @returns A checkbox input
   */
  function checkBox(nme, pk, ai, isChecked = false) {
    let checkboxHolder = document.createElement("td");
    let checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add(nme);
    checkbox.name = `row-${qsa("#row-builder tr").length}-${nme}`;
    checkbox.checked = isChecked;

    checkboxHolder.appendChild(checkbox);

    if (nme === "ai" && !pk) {
      checkbox.disabled = true;
    } else if (ai && pk && nme === "ai") {
      checkbox.checked = true;
    }

    checkbox.addEventListener("click", () => {
      hasChanges = true;
    });

    return checkboxHolder;
  }


  /**
   * Factored code that creates a close button- which removes a column
   * from a table
   * @returns A close button
   */
  function closeButton(colName) {
    let closeHolder = document.createElement("td");
    let closeButton = document.createElement("button");
    let closeIcon = document.createElement("img");
    closeIcon.src = "./images/close.svg";
    closeIcon.alt = "Close button";
    closeButton.classList.add("remove-row");

    // closeButton.addEventListener("click", deleteColFromTable);
    closeButton.addEventListener("click", function () {
      const deleteCol = () => {
        this.closest("tr").remove();
        hasChanges = true;
      }

      betterModal(
        "Are you sure you want to remove `" + colName + "`?",
        "This will remove all values stored in that column",
        deleteCol
      )
      
    });

    closeButton.appendChild(closeIcon);
    closeHolder.appendChild(closeButton);

    return closeHolder;
  }

  /**
   * Deletes a column from a table
   */
  // async function deleteColFromTable() {
  //   try {
  //     let colname = `"${this.closest("tr").dataset.name}"`;
  //     alert(`Are you sure you want to delete the column "${colname}"? (This will remove all data stored in this column!)`);

  //     if (!this.closest("tr").classList.contains("new-col")) {
  //       // delete from table for real
  //       let res = await ipc.invoke("delete-col", colname);
  //       if (res.type === "err") {
  //         throw new Error(res.err);
  //       }
  //     }

  //     qs(`#pk[value='${this.closest("tr").dataset.name}']`)
  //     this.closest("tr").remove();
  //   } catch (err) {
  //     handleError(err);
  //   }
  // }

  /**
   * Retrieves information columns in a table.
   * @returns table metadata
   */
  async function getTableColumns() {
    let res = await ipc.invoke("new-row-meta");
    if (res.type !== "err") {
      return res
    } else {
      throw new Error(res.err);
    }
  }

  /**
   * Retrieves information about a table.
   * @returns table metadata
   */
  async function getTableMeta() {
    let res = await ipc.invoke("get-table-meta");
    if (res.type !== "err") {
      return res;
    } else {
      throw new Error(res.err);
    }
  }

  function responsiveDataViewColumns(table) {
    let tableWidth = table.parentNode?.offsetWidth - 210;
    let numColumns = table.querySelectorAll("th").length - 1;

    let content = table.querySelectorAll("p, input:not([type='checkbox'])");

    [...content].forEach((elem) => {
      elem.style.maxWidth = `${tableWidth / numColumns}px`;
      elem.style.minWidth = `${tableWidth / numColumns}px`;
    });
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
  function handleError(err) {
    console.error(err);
    betterPopup("An Error Occurred :-(", err.message);
  }

  function betterModal(title, text, callback, btnYes = "Yes", btnNo = "No") {
    let popup = document.createElement("dialog");
    let tt = document.createElement("p");
    tt.classList.add("popup-title");

    let dt = document.createElement("p");
    
    tt.textContent = title;
    dt.textContent = text;

    popup.id = "disco-2001";
    let buttonHolder = document.createElement("div");
    buttonHolder.classList.add("side-by-side")


    let yesBtn = document.createElement("button");
    yesBtn.classList.add("yes");

    yesBtn.textContent = btnYes;
    yesBtn.addEventListener("click", () => {
      callback();
      popup.remove();
    });

    let noBtn = document.createElement("button");
    noBtn.classList.add("no");

    noBtn.textContent = btnNo;
    noBtn.addEventListener("click", () => {
      popup.remove();
    });

    buttonHolder.append(yesBtn, noBtn);

    popup.append(tt, dt, buttonHolder);
    qs("body").appendChild(popup);
    popup.showModal();
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
})();