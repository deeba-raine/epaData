# Import Dependencies
from collections import namedtuple
import pandas as pd
import json

# Upload Class for Upload Services
class Upload:
    def __init__(self, bad=None, question=None):
        # Set Defaults
        self.reject = ['State', '_2', '_3', '_4', 'Year', '_7', '_8', '_18', '_20', '_25']
        self.suspicious = ['_9', '_17', '_13', '_11', '_15', '_22', '_23']

        # Change if Provided
        if bad is not None:
            self.reject = bad
        if question is not None:
            self.suspicious = question

        # More Defaults
        self.originals = set()
        self.duplicates = set()
        self.rejectedReport = {'items': []}
        self.questionableReport = {'items': []}
        self.accepted = {'items': []}

        # Store Extension for File Check
        self.type = None

        # Default to Expected Columns - Store For Checks/Validation
        self.columns = ["State","Facility Name","Facility ID","Unit ID","Associated Stacks","Year",
                "Operating Time Count","Sum of the Operating Time","Gross Load (MWh)",
                "Steam Load (1000 lb)","SO2 Mass (short tons)","SO2 Rate (lbs/mmBtu)",
                "CO2 Mass (short tons)","CO2 Rate (short tons/mmBtu)","NOx Mass (short tons)",
                "NOx Rate (lbs/mmBtu)","Heat Input (mmBtu)","Primary Fuel Type","Secondary Fuel Type",
                "Unit Type","SO2 Controls","NOx Controls","PM Controls","Hg Controls","Program Code"]
        return

    def changeCheck(self, values: list[str]):
        # Change the Validated Columns
        self.columns = values
        return

    # File Validation Functions
    def inputFormat(self, fileName: str) -> bool:
        # Check File Extension
        if fileName.lower()[-4:] == '.csv':
            self.type = 'csv'
            return True
        if fileName.lower()[-5:] == '.xlsx':
            self.type = 'excel'
            return True
        # Return False if Neither .csv or .xlsx
        return False

    def columnCheck(self, data: pd.DataFrame) -> bool:
        # Ensure Dataframe Columns Match Upload Column Constraint
        if list(data.columns) == self.columns:
            return True
        return False

    def duplicateCheck(self, item: tuple) -> bool:
        check = tuple([getattr(item, x) for x in ['_3', '_4', 'Year']])
        if check in self.originals:
            self.duplicates.add(getattr(item, 'Index'))
            return False
        self.originals.add(check)
        return True

    def reportCheck(self, item: tuple) -> bool:
        # Clean Data
        item = self.clean(item)
        requiredInfo = [getattr(item, x) for x in self.reject]
        if any(pd.isna(x) for x in requiredInfo):
            # item is Missing Needed Info/Store and Continue
            self.rejectedReport["items"].append(item)
            return False

        requiredInfo = [getattr(item, x) for x in self.suspicious]
        if any(pd.isna(x) for x in requiredInfo):
            # item is Missing Useful Info/Store and Continue
            self.questionableReport["items"].append(item)
            return False
        # Passed Both Checks
        self.accepted["items"].append(item)
        return True

    # Get Methods to Obtain Metadata Stored
    def getDuplicates(self) -> dict:
        return {"Indexes": list(self.duplicates)}

    def getReports(self) -> dict:
        response = {"Invalid": self.rejectedReport, "Warning": self.questionableReport, "Valid": self.accepted}
        return response

    def getType(self) -> dict:
        return {'type': '' if self.type is None else self.type}

    # NaN to None for Jsonification
    def clean(self, item: namedtuple, header=None) -> namedtuple:
        return item._replace(**{
        field: None if pd.isna(value) else value
        for field, value in zip(item._fields, item)
        })
