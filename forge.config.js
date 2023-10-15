
module.exports = {
  packagerConfig: {
    asar: true,
    icon: './public/icons/Icon',
    osxSign: {},
    osxNotarize: {
      tool: 'notarytool',
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    }
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      iconUrl: 'https://raw.githubusercontent.com/marinawooden/BetterBrowser/d0ed5e77ab1257c76a9b3f1fa77e0d7c306968fd/public/icons/Icon.ico',
      // A URL to an ICO file to use as the application icon (displayed in Control Panel > Programs and Features).
      setupIcon: './public/img/Icon.ico'
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
      name: '@electron-forge/maker-rpm',
      icon: './public/icons/Icon-Setup.png'
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};