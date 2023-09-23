"use strict";
(function() {
  window.addEventListener("load", init);

  function init() {
    id("advanced-toggler").addEventListener("click", function () {
      this.classList.toggle("toggled");
      id("advanced-dropdown").classList.toggle("transparent");
    });
  } 

  function id(id) {
    return document.getElementById(id);
  }
})();