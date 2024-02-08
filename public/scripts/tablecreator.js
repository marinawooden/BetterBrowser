"use strict";
const ipc = require('electron').ipcRenderer;
// FOREIGN KEY("identifier") REFERENCES "Games"("identifier")
(function() {
  const SQLITE_TYPES = ["INTEGER", "REAL", "TEXT", "BLOB"];

  window.addEventListener("load", init);

  function init() {
    id("table-options").addEventListener("submit", makeNewTable);
    id("table-name").addEventListener("input", changeTableName);
    id("pk").addEventListener("change", changePrimaryKey);
    id("add-row").addEventListener("click", () => addRow());

    addRow("id");

    window.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        // alert("THE")
        makeNewTable(e);
      }
    });
  }

  function insertAfter(newNode, existingNode) {
    existingNode.parentNode.insertBefore(newNode, existingNode.nextSibling);
  }

  function addRow(name) {
    let newRow = buildRowElement(name);
    if (qsa("#row-builder tr").length > 0) {
      insertAfter(newRow, qs("#row-builder tr"));
    } else {
      qs("#row-builder tbody").appendChild(newRow);
    }
    
    // logic for updating primary key options
    let newPkOption = document.createElement("option");
    newPkOption.value = newRow.dataset.name;
    newPkOption.textContent = newRow.dataset.name;
    id("pk").appendChild(newPkOption);

    checkIfHasRows();
    responsiveDataViewColumns(id("row-builder"));
  }

  function checkIfHasRows() {
    if (qsa("#row-builder tr").length <= 1) {
      id("primary-key").classList.add("hidden");
    } else if (id("primary-key").classList.contains("hidden")) {
      qsa("#row-builder tr")[1].querySelector(".ai").disabled = false;
      id("primary-key").classList.remove("hidden");
      id("primary-key-name").textContent = qs("#pk option").textContent;
    }
  }

  function buildRowElement(colName) {
    let rowNum = qsa("#row-builder tr").length;

    let row = document.createElement("tr");
    let closTd = document.createElement("td");
    let nameTd = document.createElement("td");
    let typeTd = document.createElement("td");
    let nonNTd = document.createElement("td");
    let autoTd = document.createElement("td");
    let uniqTd = document.createElement("td");
    let fornTd = document.createElement("td");
    let defVTd = document.createElement("td");

    let close = document.createElement("img");
    let closeButton = document.createElement("button");
    closeButton.classList.add("remove-row");
    closeButton.addEventListener("click", removeRow);

    close.src = "./images/close.svg";
    close.alt = "Close button";

    closeButton.appendChild(close);
    closTd.appendChild(closeButton);

    let name = document.createElement("p");
    name.classList.add("col-name");
    name.contentEditable = true;
    name.textContent = colName ? colName : `Field${rowNum}`;
    name.addEventListener("input", updateRowName);
    nameTd.appendChild(name);

    let typeSelect = document.createElement("select");
    typeSelect.addEventListener("change", (e) => {
      // 
      // change the type
      let v = e.currentTarget.closest("tr").parentNode.children;
      let nameDisplayed = qs("p[class='" + (colName ? colName : `Field${rowNum}`) + "']").querySelector(".col-type");
      nameDisplayed.textContent = e.currentTarget.value;
    })

    SQLITE_TYPES.forEach((type) => {
      let optn = document.createElement("option");
      optn.value = type;
      optn.textContent = type;

      typeSelect.appendChild(optn);
    })
    typeTd.appendChild(typeSelect);

    // NONNULL CHECK
    let nnCheck = checkBox(`row-${rowNum}-nn`, 'nn');
    nnCheck.addEventListener("change", () => {
      let nonNullText = qs("p[class='" + (row.dataset.name) + "']").querySelector(".col-nn");
      nonNullText.classList.toggle("hidden");
    });
    nonNTd.appendChild(nnCheck);

    // AUTOINCREMENT CHECKBOX
    let auto = checkBox(`row-${rowNum}-ai`, 'ai');
    auto.addEventListener("change", () => {
      let isAutoincrement = id("autoincrement").textContent;

      if (isAutoincrement) {
        id("autoincrement").textContent = "";
      } else {
        id("autoincrement").textContent = "AUTOINCREMENT"
      }
    });

    // disabled by default
    auto.disabled = true;
    autoTd.appendChild(auto);

    // UNIQUE CHECKBOX
    let uniqueCheck = checkBox(`row-${rowNum}-u`, 'u');
    uniqueCheck.addEventListener("change", () => {
      let nonNullText = qs("p[class='" + (row.dataset.name) + "']").querySelector(".col-u");
      nonNullText.classList.toggle("hidden");
    })
    uniqTd.appendChild(uniqueCheck);

    let fk = checkBox(`row-${rowNum}-fk`, "fk-check");
    fk.addEventListener("change", createFkInput);
    fornTd.appendChild(fk);

    let defV = document.createElement("input");
    defV.classList.add("def");
    defV.type = "text";
    defV.name = `row-${rowNum}-name`;
    defVTd.appendChild(defV);

    defV.addEventListener("input", (e) => {
      let newString = e.currentTarget.value.trim();
      let nameDisplayed = qs("p[class='" + (row.dataset.name) + "']").querySelector(".col-default");

      nameDisplayed.textContent = ` DEFAULT ${newString}`;
      if (newString.length <= 0) {
        nameDisplayed.classList.add('hidden')
      } else if (nameDisplayed.classList.contains("hidden")) {
        nameDisplayed.classList.remove("hidden");
      }
    });

    row.dataset.name = colName ? colName : `Field${rowNum}`;
    row.append(closTd, nameTd, typeTd, nonNTd, autoTd, uniqTd, fornTd, defVTd);
    addRowToQuery(colName ? colName : `Field${rowNum}`);
    return row;
  }

  async function getForeignKeys() {
    try {
      let res = await ipc.invoke("get-other-columns");
      if (res.type === "err") {
        throw new Error(res.error);
      }
      return res;
    } catch (err) {
      handleError(err);
    }
  }

  async function createFkInput() {
    try {
      if (this.checked) {
        let table = this.closest("table");
        let rows = table.querySelectorAll("tr");

        for (let i = 0; i < rows.length; i++) {
          let row = rows[i];
          if (!id("fk-row")) {
            let rowHead = document.createElement("th");
            rowHead.textContent = "Foreign Keys";
            rowHead.id = "fk-row";

            row.appendChild(rowHead);
          }

          if (row.querySelector(".fk-check")?.checked && !row.querySelector(".fk")) {
            let rowSelectHolder = document.createElement("td");
            let rowSelect = document.createElement("select");
            let foreignKeys = await getForeignKeys();

            Object.keys(foreignKeys.results).forEach((table) => {
              let columns = foreignKeys.results[table];
              let optgroup = document.createElement("optgroup");
              optgroup.label = table;

              columns.forEach((optn) => {
                let optnElem = document.createElement("option");
                optnElem.value = `${table}.${optn}`;
                optnElem.textContent = optn;
                optgroup.append(optnElem);
              })
              rowSelect.appendChild(optgroup)
            });

            rowSelectHolder.classList.add("fk");
            rowSelectHolder.appendChild(rowSelect);

            rowSelect.addEventListener("change", function() {
              addNewForeignKeyToStatement(this)
            });
            row.appendChild(rowSelectHolder);
            addNewForeignKeyToStatement(rowSelect);
            responsiveDataViewColumns(id("row-builder"));
          }
        }
      } else {
        this.closest("tr").querySelector(".fk").innerHTML = "";
        if (qsa(".fk-check:checked").length === 0) {
          id("row-builder").querySelector("tr").lastChild.remove();
          this.closest("tr").querySelector(".fk").remove();
          id(`${this.closest('tr').dataset.name}-fk`).closest("p").remove();
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

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
      return [col.querySelector(".col-name")?.textContent, def];
    });
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
      console.error(err);
    }
  }

  function responsiveDataViewColumns(table) {
    // the max width
    // qs("#viewer")

    let tableWidth = table?.parentNode?.offsetWidth - 210;
    let numColumns = table?.querySelectorAll("th").length - 1;

    let content = table?.querySelectorAll("td p, td input[type='text']");

    if (content) {
      [...content].forEach((elem) => {
        elem.style.maxWidth = `${tableWidth / numColumns}px`;
        elem.style.minWidth = `${tableWidth / numColumns}px`;
      });
    }
  }

  /** FOREIGN KEY("identifier") REFERENCES "Games"("identifier") */
  function addNewForeignKeyToStatement(selection) {
    let fkey = selection.value;
    let referencesTable = fkey.split(".")[0];
    let referencesColum = fkey.split(".")[1];
    let colInTable = selection.closest("tr").dataset.name;
    let stmt = document.createElement("p");

    if (id(`${colInTable}-fk`)) {
      id(`${colInTable}-fk`).parentNode.remove();
    }

    stmt.textContent = `FOREIGN KEY("`;

    let colTableElem = document.createElement("span");
    colTableElem.id = `${colInTable}-fk`;
    colTableElem.textContent = colInTable;
    stmt.appendChild(colTableElem);
    stmt.appendChild(document.createTextNode(`") REFERENCES "${referencesTable}"("${referencesColum}")`));

    id("foreign-keys").appendChild(stmt);
    // removal as well
  }

  function addRowToQuery(colName) {
    let row = document.createElement("p");
    row.classList.add(colName);

    let nm = document.createElement("span");
    nm.classList.add("col-name");
    nm.textContent = `"${colName}" `

    let kind = document.createElement("span");
    kind.classList.add("col-type");
    kind.textContent = SQLITE_TYPES[0];

    let nn = document.createElement("span");
    nn.classList.add("col-nn");
    nn.classList.add("hidden");
    nn.textContent = ` NOT NULL `;

    let u = document.createElement("span");
    u.classList.add("col-u");
    u.classList.add("hidden");
    u.textContent = ` UNIQUE `;

    let deflt = document.createElement("span");
    deflt.classList.add("col-default");
    
    row.append(nm, kind, u, nn, deflt, ",");
    id("rows").appendChild(row);
  }

  function updateRowName(e) {
    let newRowName = e.currentTarget.textContent;
    let prevValue = e.currentTarget.closest('tr').dataset.name;
    let pkOption = qs(`option[value='${prevValue}']`);// getChildIndex

    pkOption.textContent = newRowName;
    pkOption.value = newRowName;
    id("primary-key-name").textContent = id("pk").value;

    e.currentTarget.closest('tr').dataset.name = newRowName;

    let queryComponent = qs("#rows").children[[...pkOption.parentNode.children].indexOf(pkOption)];
    queryComponent.querySelector(".col-name").textContent = `"${newRowName}" `;

    // update foreign key value
    if (id(`${prevValue}-fk`)) {
      id(`${prevValue}-fk`).textContent = newRowName;
      id(`${prevValue}-fk`).id = `${newRowName}-fk`;
    }

    if (prevValue && newRowName) {
      queryComponent.classList.replace(prevValue, newRowName);
    } else {
      queryComponent.class = "";
    }
    
  }

  function removeRow(e) {
    let row = e.currentTarget.closest("tr");
    let rowName = row.dataset.name;

    if (id("primary-key-name").textContent === rowName) {
      qsa("#row-builder tr")[1].querySelector(".ai").disabled = false;
      id("primary-key-name").textContent = qs("#pk option")?.value ? qs("#pk option").value : "";
    }

    qs(`#pk option[value='${rowName}']`).remove();
    if (rowName) {
      qs(`#rows .${rowName}`).remove();
    } else {
      console.log([...qsa(`#rows .col-name`)].find((col) => col.textContent == '""'));
      // find row with no name
      [...qsa(`#rows .col-name`)].find((col) => col.textContent == '""')?.remove();
    }
    
    row.remove();

    checkIfHasRows();
  }

  function checkBox(name, cls) {
    let checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add(cls);
    checkbox["name"] = name;

    return checkbox;
  }

  /** Changest which row is the primary key */
  function changePrimaryKey(e) {
    let primaryKeyColumnName = e.currentTarget.value;
    let prevPrimaryKey = id("primary-key-name").textContent;

    id("primary-key-name").textContent = primaryKeyColumnName;
    qs(`tr[data-name='${prevPrimaryKey}']`).querySelector(".ai").disabled = true;
    qs(`tr[data-name='${prevPrimaryKey}']`).querySelector(".ai").checked = false;
    id("autoincrement").classList.add("hidden");
    qs(`tr[data-name='${primaryKeyColumnName}']`).querySelector(".ai").disabled = false;
  }

  /** Changes the displayed table name in the SQL query */
  function changeTableName(e) {
    let tableName = e.currentTarget.value;
    id("new-table-name").textContent = tableName;
  }

  async function makeNewTable(e) {
    e.preventDefault();
    try {
      // let query = qs("#create-table-query").textContent;
      let query = `CREATE TABLE \`${id("new-table-name").textContent}\` (\n`;
      query += creationStmt();
      query += "\n);";
      
      await ipc.invoke('add-table', query);
      // alert(tables);
    } catch (err) {
      handleError(err);
    }
  }

  function qsa(query) {
    return document.querySelectorAll(query);
  }

  function qs(query) {
    return document.querySelector(query);
  }

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