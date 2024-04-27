#!/usr/bin/env node
import {globby} from "globby";
import fs from "fs";

async function main(options) {

    var value = new Promise(async (resolve, reject) => {
      // get a list of yaml files
      const basePaths = await globby(options.searchPatterns);

      // lof the version file for the environment
      let versionFile = options.versionFile;
      if(options.debug) console.log(`versionFile ${versionFile}`);
      let versions=JSON.parse(fs.readFileSync(versionFile,"utf8"));

	  // if package.json was passed then add it to the versions file.
	  if(options.package) {
		let pkg = options.package;
      	if(options.debug) console.log(`package ${pkg}`);
      	pkg=JSON.parse(fs.readFileSync(pkg,"utf8"));
		let name = pkg.name.split('/');
		name=name[name.length-1];
		versions[name]=pkg.version;
	  }

      let keys = Object.keys(versions);

      // loop through all matching yaml files
      for(let f=0;f<basePaths.length;f++) {
        if(options.debug) console.log(`reading ${basePaths[f]}`);
        let before = fs.readFileSync(basePaths[f],"utf8");
        let after = before;

        // loop through all of the versions in the version file
        for(let i=0;i<keys.length;i++) {
          let name = keys[i];

          //replace docker versions
          let pattern = new RegExp(`${name}==REPLACE`,'gi');
          after = after.replace(pattern,`${name}==${versions[keys[i]]}`);

          //replace docker versions
          pattern = new RegExp(`${name}:REPLACE`,'gi');
          after = after.replace(pattern,`${name}:${versions[keys[i]]}`);

          // replace npm versions
          pattern = new RegExp(`${name}@REPLACE`,'gi');
          after = after.replace(pattern,`${name}@${versions[keys[i]]}`);
        }

        // check to see if something changed, write file if it did
        if(before!==after) {
          console.log(`update ${basePaths[f]}`);
          if(options.update) fs.writeFileSync(basePaths[f],after);
        }
      }

      resolve("DONE");

      });

    return value;
}

let options = {
  searchPatterns:["k8s/**/*.yaml"],
  versionFile:"versions.json",
  package:"",
  debug:false,
  update: true
};


let argv = process.argv;
for(let i=2;i<argv.length;i++) {
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
