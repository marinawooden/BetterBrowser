module.exports = {
  packagerConfig: {
    asar: true,
    icon: './public/icons/Icon'
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        // An URL to an ICO file to use as the application icon (displayed in Control Panel > Programs and Features).
        setupIcon: './public/img/Icon.ico'
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './public/icons/Icon.png'
        }
      },
    },
    {
      // Path to the icon to use for the app in the DMG window
      name: '@electron-forge/maker-dmg',
      config: {
        // icon: './public/icons/Icon-Setup.icns',
        // background: './public/icons/Installer-BG.png',
       
        background: "./public/icons/installerbg.tiff",
        format: 'ULFO',
        icon: "./public/icons/Icon.icns",
        iconSize: 75,
        window: {
          width: 540,
          height: 380
        },
        contents: [
          {
            x: 145,
            y: 255,
            type: "file",
            path: `${process.cwd()}/out/BetterBrowser-darwin-x64/BetterBrowser.app`
          },
          {
            x: 395,
            y: 255,
            type: "link",
            path: "/Applications"
          }
        ]
      }
    },
    {
      name: '@electron-forge/maker-wix',
      config: {
        icon: './public/icons/Icon-Setup.png'
      }
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        icon: './public/icons/Icon-Setup.png'
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};