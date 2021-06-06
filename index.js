const lib = require('tp-link-tapo-connect');

const PLATFORM_NAME = 'TapoLightPlatform';
const PLUGIN_NAME = 'homebridge-tapo-lamp';

module.exports = (api) => {
  api.registerPlatform('TapoLightPlatform', TapoLightPlatform);
};

class TapoLightPlatform {
  constructor(log, config, api) {
      this.log = log;
      this.config = config;
      this.api = api;

      this.Service = this.api.hap.Service;
      this.Characteristic = this.api.hap.Characteristic;
      this.name = config.name;
      this.accessories = [];
      this.lamps = config.lamps;

      const useService = (acc, uuid) => acc.getService(uuid) || acc.addService(uuid);

      const configureAccessory = async (config, acc, send) => {
        const info = await send(token => lib.getDeviceInfo(token));

        console.log(info);

        if (!info.dynamic_light_effect_enable) {
          const request = {
            "method": "set_device_info",
            "params": {
              dynamic_light_effect_enable: true
            },
          }

          await send(token => lib.securePassthrough(request, token))
            .then(console.log)
            .catch(err => log.error(err));
        }

        const addSetting = useThrottle(async (settings) => {
          const request = {
            "method": "set_device_info",
            "params": settings,
          }

          send(token => lib.securePassthrough(request, token))
            .catch(err => log.error(err));
        });
        
        const setBorders = (value, max, min) => value > max ? max : (value < min ? min : value);
        const fromHbToTemp = (value) => setBorders(Math.floor(1000000 / value), 6500, 2500);
        const fromTempToHb = (value) => setBorders(Math.floor(1000000 / value), 500, 140);
        
        const service = useService(acc, this.Service.Lightbulb);

        service.getCharacteristic(this.Characteristic.On)
          .onGet(() => info.device_on)
          .onSet((val) => send(token => lib.turnOn(token, Boolean(info.device_on = val))));

        service.getCharacteristic(this.Characteristic.Hue)
          .onGet(() => info.hue)
          .onSet(hue => addSetting({ hue }));

        service.getCharacteristic(this.Characteristic.Brightness)
          .onGet(() => info.brightness)
          .onSet(brightness => addSetting({ brightness: setBorders(brightness, Infinity, 1) }));
        
        service.getCharacteristic(this.Characteristic.Saturation)
          .onGet(() => info.saturation)
          .onSet(saturation => addSetting({ saturation }));
        
        service.getCharacteristic(this.Characteristic.ColorTemperature)
          .onGet(() => fromTempToHb(info.color_temp))
          .onSet((val) => {
            console.log('>>> COLOR: ', val, fromHbToTemp(val));
            addSetting({ color_temp: fromHbToTemp(val) });
          });
      };

      api.on('didFinishLaunching', async () => {
        for(const lamp of this.lamps) {
          const uuid = api.hap.uuid.generate(lamp.ip);
          let accessory = this.accessories.find(acc => acc.UUID === uuid);
          const requestToken = () => lib.loginDeviceByIp(config.login, config.password, lamp.ip);

          let token = await requestToken();

          const request = async (cb) => {
            try {
              return await cb(token);
            } catch(err) {
              return await cb(token = await requestToken());
            }
          };

          if(!accessory) {
            console.log('>>> Add New Accessory: ' + lamp.ip);
            accessory = new this.api.platformAccessory(lamp.name, uuid);
            await configureAccessory(lamp, accessory, request);
            api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          } else {
            console.log('>>> Update Accessory: ' + lamp.ip);
            await configureAccessory(lamp, accessory, request);
            api.updatePlatformAccessories([accessory]);
          }
        }
      });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }
}

function useThrottle(cb) {
  let hash = {};
  let prepared = null;

  return (update) => {
    Object.assign(hash, update);

    if (!prepared) {
      prepared = setTimeout(() => {
        cb(hash);
        hash = {};
        prepared = false;
      }, 20);
    }
  };
}
