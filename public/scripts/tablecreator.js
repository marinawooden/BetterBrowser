"use strict";
const ipc = require('electron').ipcRenderer;

(function() {
  const SQLITE_TYPES = ["INTEGER", "REAL", "TEXT", "BLOB"];

  window.addEventListener("load", init);

  function init() {
    id("table-options").addEventListener("submit", makeNewTable);
    id("table-name").addEventListener("input", changeTableName);
    id("pk").addEventListener("change", changePrimaryKey);
    id("add-row").addEventListener("click", () => addRow());

    addRow("id")
  }

  function addRow(name) {
    let newRow = buildRowElement(name);
    qs("#row-builder tbody").appendChild(newRow);

    // logic for updating primary key options
    let newPkOption = document.createElement("option");
    newPkOption.value = newRow.dataset.name;
    newPkOption.textContent = newRow.dataset.name;
    id("pk").appendChild(newPkOption)

    checkIfHasRows();
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
    name.contentEditable = true;
    name.textContent = colName ? colName : `Field${rowNum}`;
    name.addEventListener("input", updateRowName);
    nameTd.appendChild(name);

    let typeSelect = document.createElement("select");
    typeSelect.addEventListener("change", (e) => {
      // change the type
      let nameDisplayed = qs("p[class='" + (row.dataset.name) + "']").querySelector(".col-type");
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

    let fk = checkBox(`row-${rowNum}-fk`);
    fk.addEventListener("change", () => alert("THE"));
    fornTd.appendChild(fk);

    let defV = document.createElement("input");
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
    let newRowName = e.currentTarget.textContent || "_";
    if (newRowName !== e.currentTarget.textContent) {
      e.currentTarget.textContent = newRowName
    }

    let prevValue = e.currentTarget.closest('tr').dataset.name;
    let pkOption = qs(`option[value='${prevValue}']`);

    pkOption.textContent = newRowName;
    pkOption.value = newRowName;

    e.currentTarget.closest('tr').dataset.name = newRowName;
 
    qs(`.${prevValue} .col-name`).textContent = `"${newRowName}" `;
    qs(`.${prevValue}`).classList.replace(prevValue, newRowName);
    
    if (id("primary-key-name").textContent === prevValue) {
      id("primary-key-name").textContent = newRowName;
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
    qs(`#rows .${rowName}`).remove();
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
      let query = qs("#create-table-query").textContent;
      let tables = await ipc.invoke('add-table', query);
      alert(tables);
    } catch (err) {
      alert(err);
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
})();