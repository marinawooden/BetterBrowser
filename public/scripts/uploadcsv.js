"use strict";
(function() {
  const ipc = require('electron').ipcRenderer;
  window.addEventListener("load", init);

  function init() {
    getData();
    id("first-row").addEventListener("change", getData);
    id("separator").addEventListener("input", function() {
      if (this.value.trim() !== "") {
        getData()
      }
    })

    id("advanced-toggler").addEventListener("click", function () {
      this.classList.toggle("toggled");
      id("advanced-dropdown").classList.toggle("transparent");
    });

    id("create-table").addEventListener("click", async () => {
      await createTable();
    });

    window.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        await createTable();
      }
    });
  };

  async function createTable() {
    try {
      console.log([...qsa("#table-preview th")]);
      let colnames = [...qsa("#table-preview th")].map((elem) => elem.textContent);
      await ipc.invoke("create-from-csv", id("table-name").value || "Table 1", id("separator").value, id("first-row").checked, colnames);

      // ipc.once("edits-complete", async () => {
      //   await populateDbView();
      //   await populateDataViewerOptions();
      // });
    } catch (err) {
      handleError(err);
    }
  }

  async function getData() {
    try {
      let res = await ipc.invoke("get-csv-data", id("separator").value, id("first-row").checked);
      statusCheck(res);
      
      populateTable(res.content);
    } catch (err) {
      handleError(err);
    }
  }

  async function populateTable(data) {
    qs("#table-preview tbody").innerHTML = "";
    qs("#table-preview thead").innerHTML = "";

    let headerRow = document.createElement("tr");
    let hasColumns = !(data[0] instanceof Array);
    let iterations = hasColumns ? Object.keys(data[0]).length : data[0].length;
    id("primary-key").innerHTML = "";

    for (let i = 0; i < iterations; i++) {
      let headerCol = document.createElement("th");
      let columnName = hasColumns ? Object.keys(data[0])[i] : `Column ${i + 1}`;
      headerCol.textContent = columnName;

      let pkSelection = document.createElement("option");
      pkSelection.value = columnName;
      pkSelection.textContent = columnName;

      headerRow.appendChild(headerCol);
      id("primary-key").appendChild(pkSelection);
    }

    qs("#table-preview thead").appendChild(headerRow);

    if (hasColumns) {
      data = data.map((obj) => Object.values(obj));
    }

    data.forEach((row) => {
      let rowElem = document.createElement("tr");
      row.forEach((col) => {
        let colElem = document.createElement("td");
        colElem.textContent = col;

        rowElem.appendChild(colElem);
      })

      qs("#table-preview tbody").appendChild(rowElem);
    });
  }

  function qs(query) {
    return document.querySelector(query);
  }

  function qsa(query) {
    return document.querySelectorAll(query);
  }

  function statusCheck(res) {
    if (res.type === "err") {
      throw new Error(res.err);
    }
    return res;
  }

  function handleError(err) {
    alert(err.message);
  }

  function id(id) {
    return document.getElementById(id);
  }
})();