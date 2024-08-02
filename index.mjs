#!/usr/bin/env node
import {globby} from "globby";
import yaml from 'js-yaml';
import get from "lodash/get.js";
import findKey from "lodash/findKey.js";
import fs from "fs";


function replaceVersions(txt,versions) {
  // loop through all of the versions in the version file
  let keys = Object.keys(versions);
  for(let i=0;i<keys.length;i++) {
    let name = keys[i];

    //replace docker versions
    let pattern = new RegExp(`${name}==REPLACE`,'gi');
    txt = txt.replace(pattern,`${name}==${versions[keys[i]]}`);

    //replace docker versions
    pattern = new RegExp(`${name}:REPLACE`,'gi');
    txt = txt.replace(pattern,`${name}:${versions[keys[i]]}`);

    // replace npm versions
    pattern = new RegExp(`${name}@REPLACE`,'gi');
    txt = txt.replace(pattern,`${name}@${versions[keys[i]]}`);
  }

  return txt;
}

function replaceReplicas(txt,replicas,name,options) {
  // see if this has a replica
  let match = txt.match(/replicas:\s+([0-9]+)/gm);
  if(!match) return txt;  // no so bounce

  // if not specified the default will be to set to 0
  let _default = replicas._default;
  if(_default===undefined) _default=0;

  if(options.debug) console.log(match);

  // store current
  let current = match[0].split(":")[1].trim();
  let newValue = _default;

  if(replicas[name]) newValue = replicas[name];

  if(current !== newValue) {
    return txt.replace(/replicas:\s+([0-9]+)/gm,`replicas: ${newValue}`);
  }

  return txt;
}

function replaceResources(txt,resources,name,doc,options) {
  let list = [];
  let containers = get(doc,"spec.template.spec.containers");
  if(containers && containers.length>0) {
    containers.forEach((c)=>{if(c.resources) list.push(c)});
  }
  let initContainers = get(doc,"spec.template.spec.initContainers");
  if(initContainers && initContainers.length>0) {
    initContainers.forEach((c)=>{if(c.resources) {c.init=true; list.push(c) } });
  }

  // see if this has a resources section
  if(list.length===0) return txt;  // no so bounce

  let _defaults = resources._defaults || {};
  let settings = {..._defaults,...(resources[name]||{})};
  settings.requests = settings.requests || {};
  settings.limits = settings.limits || {};

  let keys = Object.keys(resources);
  for(let i=0;i<list.length;i++) {
    let c=list[i];
    let r=c.resources;
    let limits = c.init ? settings.init_limits || settings.limits : settings.limits;
    let requests = c.init ? settings.init_requests || settings.requests : settings.requests;

    if(r.limits) {
      Object.keys(limits).forEach((k)=>{
        if(limits[k]==="0" || limits[k]===0)
          delete r.limits[k];
        else
          r.limits[k] = limits[k];
      });
    }
    if(r.requests) {
      Object.keys(requests).forEach((k)=>{
        if(requests[k]==="0" || requests[k]===0)
          delete r.requests[k];
        else
          r.requests[k] = requests[k];
      });
    }

    delete c.init;
  }

  return yaml.dump(doc);
}

function replaceStrings(txt,strings,name,options) {
  let _defaults = strings._defaults || {};
  let settings = {..._defaults,...(strings[name]||{})};

  Object.keys(settings).forEach((k)=>{
    let r = new RegExp(`${k}`,"gm");
    txt=txt.replace( r,settings[k]);
  });

  return txt;
}

async function main(options) {

    var value = new Promise(async (resolve, reject) => {
      // get a list of yaml files
      const basePaths = await globby(options.searchPatterns);

      let config = {
        versions:{},
        replicas:{_default:0},
        resources:{_defaults:{requests:{},limits:{}}},
        strings:{}
      }
      let versions = config.versions;
      let replicas = config.replicas;
      let resources = config.resources;
      let strings = config.strings;

      // if package.json was passed then add it to the versions file.
      if(options.scanPackage) {
        const pkgs = await globby(["**/package.json","package.json","!node_modules"]);
        for(let f=0;f<pkgs.length;f++) {
          let pkg = pkgs[f];
          if(options.debug) console.log(`package ${pkg}`);
          pkg=JSON.parse(fs.readFileSync(pkg,"utf8"));
          let name = pkg.name.split('/');
          name=name[name.length-1];
          versions[name]=pkg.version;
        }
      }

      // config files are applied in order, and overwrite package versions.
      let versionFile = options.versionFile.split(',');
      for(let i=0;i<versionFile.length;i++) {
        if(options.debug) console.log(`reading versionFile ${versionFile[i]}`);
        let c = JSON.parse(fs.readFileSync(versionFile[i].trim(),"utf8"));

        let v = c;
        if(c.versions || c.resources || c.replicas || c.strings) {
          if(c.versions) {
            v=c.versions;
            Object.keys(v).forEach(function (key) {
              versions[key]=v[key];
            });
          }

          if(c.replicas) {
            let r=c.replicas;
            Object.keys(r).forEach(function (key) {
              replicas[key]=r[key];
            });
          }

          if(c.resources) {
            let r=c.resources;
            Object.keys(r).forEach(function (key) {
              resources[key]=r[key];
            });
            if(r._defaults && r._defaults.requests) {
              resources._defaults.requests =  {...(resources._defaults.requests||{}),  ...(r._defaults.requests) };
            }
            if(r._defaults && r._defaults.limits) {
              resources._defaults.limits =  {...(resources._defaults.limits||{}),  ...(r._defaults.limits) };
            }
          }

          if(c.strings) {
            let r=c.strings;
            Object.keys(r).forEach(function (key) {
              if(!strings[key]) strings[key]=r[key];
              else {
                let o=r[key];
                replicas[key]=replicas[key] || {};
                Object.keys(o).forEach(function (key2) {
                  replicas[key][key2]=o[key2];
                });
              }
            });
          }
        } else {
          // no sections found treat as a versions only
          Object.keys(v).forEach(function (key) {
            versions[key]=v[key];
          });
        }
      }

      if(options.debug) console.log('versions',JSON.stringify(versions,null,2));

      // loop through all matching yaml files
      for(let f=0;f<basePaths.length;f++) {
        if(options.debug) console.log(`reading ${basePaths[f]}`);
        let before = fs.readFileSync(basePaths[f],"utf8");
        let after = before;

        after=replaceVersions(after,versions,options);

        // the rest of the replacements are configured deployment get name of deployment
        let nameMatch = after.match(/^metadata:.*[\n\r]\s+name:\s+([A-Za-z0-9--_]+)/m);
        if(!nameMatch) continue;  // does not have a name so bounce
        nameMatch = nameMatch[0].match(/name:\s+([A-Za-z0-9--_]+)/m);
        if(!nameMatch) continue;  // does not have a name so bounce
        if(options.debug) console.log(nameMatch[0]);
        let name = nameMatch[0].split(":")[1].trim();

        after=replaceReplicas(after,replicas,name,options);

        let doc = yaml.load(after);
        after=replaceResources(after,resources,name,doc,options);
        after=replaceStrings(after,strings,name,options);

        // check to see if something changed, write file if it did
        if(before!==after) {
          console.log(`update ${basePaths[f]}`);
          if(options.debug) fs.writeFileSync(basePaths[f]+".debug",after);
          else if(options.update) fs.writeFileSync(basePaths[f],after);
        }
      }

      resolve("DONE");

      });

    return value;
}

let options = {
  searchPatterns:["**/*.yaml"],
  versionFile:"tests/versions.json",
  scanPackage:false,
  debug:false,
  update: true
};


let argv = process.argv;
for(let i=2;i<argv.length;i++) {
  if(argv[i].toLocaleLowerCase()==="--scanpackage") { options.scanPackage=true; continue; }
  if(argv[i]==="--noupdate") { options.push=false; continue; }
  if(argv[i]==="--debug") { options.debug=true; continue; }
  if(argv[i].substring(0,2)==="--") {
      let name = argv[i].substring(2);
      if(options[name]!==undefined) {
          let val = argv[i+1];
          if(name==='searchPatterns') val=val.split(',');
          options[name] = val;
          i++;
      } else {
          console.error('Expected a known option');
          process.exit(1);
      }
  }
}

(async ()=> {
  try {
      console.log('\x1b[32m%s\x1b[0m',"Running with options:\n",JSON.stringify(options,null,2));
      main(options).then(()=>{
        if(options.debug) console.log("DONE");
        process.exit(0);
      },()=>{
        if(options.debug) console.log("ERROR");
        process.exit(1);
      })
  } catch (e) {
      process.exit(1);
  }
})();
