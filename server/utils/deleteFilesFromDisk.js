const fs = require("fs");

const deleteFilesFromDisk = (req) => {
  if (req.files) {
    for (let key in req.files) {
      deleteTempFile(req.files[key][0].path);
    }
  } else if (req.file) {
    deleteTempFile(req.file.path);
  }
};

// method to delete a file from upload folder
const deleteTempFile = (filePath) => {
  fs.stat(filePath, (err, stats) => {
    // console.log(stats);//here we got all information of file in stats variable

    if (err) {
      console.error(err);
    }

    fs.unlink(filePath, (error) => {
      if (error) {
        console.log(error);
      }
      console.log("file deleted successfully");
    });
  });
};

module.exports = { deleteTempFile, deleteFilesFromDisk };
