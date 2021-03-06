import { combineReducers } from 'redux';
import {
  CLOSE_ERROR_MODAL,
  fulfilled, GET_EXPERIMENT_API, GET_RUN_API, isFulfilledApi, isPendingApi,
  isRejectedApi,
  LIST_ARTIFACTS_API,
  LIST_EXPERIMENTS_API, OPEN_ERROR_MODAL, SEARCH_RUNS_API, SET_TAG_API,
} from '../Actions';
import {Experiment, Param, RunInfo, RunTag } from '../sdk/MlflowMessages';
import { ArtifactNode } from '../utils/ArtifactUtils';
import { metricsByRunUuid, latestMetricsByRunUuid } from './MetricReducer';
import _ from 'lodash';

export const getExperiments = (state) => {
  return Object.values(state.entities.experimentsById);
};

export const getExperiment = (id, state) => {
  return state.entities.experimentsById[id];
};

const experimentsById = (state = {}, action) => {
  switch (action.type) {
    case fulfilled(LIST_EXPERIMENTS_API): {
      let newState = Object.assign({}, state);
      if (action.payload && action.payload.experiments) {
        action.payload.experiments.forEach((eJson) => {
          const experiment = Experiment.fromJs(eJson);
          newState = Object.assign(newState, {[experiment.getExperimentId()]: experiment});
        });
      }
      return newState;
    }
    case fulfilled(GET_EXPERIMENT_API): {
      const {experiment} = action.payload;
      return {
        ...state,
        [experiment.experiment_id]: Experiment.fromJs(experiment),
      };
    }
    default:
      return state;
  }
};

export const getRunInfo = (runUuid, state) => {
  return state.entities.runInfosByUuid[runUuid];
};

const runInfosByUuid = (state = {}, action) => {
  switch (action.type) {
    case fulfilled(GET_EXPERIMENT_API): {
      let newState = { ...state };
      if (action.payload && action.payload.runs) {
        action.payload.runs.forEach((rJson) => {
          const runInfo = RunInfo.fromJs(rJson);
          newState = amendRunInfosByUuid(newState, runInfo);
        });
      }
      return newState;
    }
    case fulfilled(GET_RUN_API): {
      const runInfo = RunInfo.fromJs(action.payload.run.info);
      return amendRunInfosByUuid(state, runInfo);
    }
    case fulfilled(SEARCH_RUNS_API): {
      let newState = { ...state };
      if (action.payload && action.payload.runs) {
        action.payload.runs.forEach((rJson) => {
          const runInfo = RunInfo.fromJs(rJson.info);
          newState = amendRunInfosByUuid(newState, runInfo);
        });
      }
      return newState;
    }
    default:
      return state;
  }
};

const amendRunInfosByUuid = (state, runInfo) => {
  return {
    ...state,
    [runInfo.getRunUuid()]: runInfo
  };
};

export const getParams = (runUuid, state) => {
  const params = state.entities.paramsByRunUuid[runUuid];
  if (params) {
    return params;
  } else {
    return {};
  }
};

const paramsByRunUuid = (state = {}, action) => {
  const paramArrToObject = (params) => {
    const paramObj = {};
    params.forEach((p) => paramObj[p.key] = Param.fromJs(p));
    return paramObj;
  };
  switch (action.type) {
    case fulfilled(GET_RUN_API): {
      const run = action.payload.run;
      const runUuid = run.info.run_uuid;
      const params = run.data.params || [];
      const newState = { ...state };
      newState[runUuid] = paramArrToObject(params);
      return newState;
    }
    case fulfilled(SEARCH_RUNS_API): {
      const runs = action.payload.runs;
      const newState = { ...state };
      if (runs) {
        runs.forEach((rJson) => {
          const runUuid = rJson.info.run_uuid;
          const params = rJson.data.params || [];
          newState[runUuid] = paramArrToObject(params);
        });
      }
      return newState;
    }
    default:
      return state;
  }
};


export const getRunTags = (runUuid, state) => {
  const tags = state.entities.tagsByRunUuid[runUuid];
  if (tags) {
    return tags;
  } else {
    return {};
  }
};

const tagsByRunUuid = (state = {}, action) => {
  const tagArrToObject = (tags) => {
    const tagObj = {};
    tags.forEach((tag) => tagObj[tag.key] = RunTag.fromJs(tag));
    return tagObj;
  };
  switch (action.type) {
    case fulfilled(GET_RUN_API): {
      const runInfo = RunInfo.fromJs(action.payload.run.info);
      const tags = action.payload.run.data.tags || [];
      const runUuid = runInfo.getRunUuid();
      const newState = {...state};
      newState[runUuid] = tagArrToObject(tags);
      return newState;
    }
    case fulfilled(SEARCH_RUNS_API): {
      const runs = action.payload.runs;
      const newState = { ...state };
      if (runs) {
        runs.forEach((rJson) => {
          const runUuid = rJson.info.run_uuid;
          const tags = rJson.data.tags || [];
          newState[runUuid] = tagArrToObject(tags);
        });
      }
      return newState;
    }
    case fulfilled(SET_TAG_API): {
      const tag = {key: action.meta.key, value: action.meta.value};
      return amendTagsByRunUuid(state, [tag], action.meta.runUuid);
    }
    default:
      return state;
  }
};

const amendTagsByRunUuid = (state, tags, runUuid) => {
  let newState = { ...state };
  if (tags) {
    tags.forEach((tJson) => {
      const tag = RunTag.fromJs(tJson);
      const oldTags = newState[runUuid] ? newState[runUuid] : {};
      newState = {
        ...newState,
        [runUuid]: {
          ...oldTags,
          [tag.getKey()]: tag,
        }
      };
    });
  }
  return newState;
};

export const getArtifacts = (runUuid, state) => {
  return state.entities.artifactsByRunUuid[runUuid];
};

const artifactsByRunUuid = (state = {}, action) => {
  switch (action.type) {
    case fulfilled(LIST_ARTIFACTS_API): {
      const queryPath = action.meta.path;
      const runUuid = action.meta.runUuid;
      let artifactNode = state[runUuid] || new ArtifactNode(true);
      // Make deep copy.
      artifactNode = artifactNode.deepCopy();

      const files = action.payload.files;
      // Do not coerce these out of JSON because we use JSON.parse(JSON.stringify
      // to deep copy. This does not work on the autogenerated immutable objects.
      if (queryPath === undefined) {
        // If queryPath is undefined, then we should set the root's children.
        artifactNode.setChildren(files);
      } else {
        // Otherwise, traverse the queryPath to get to the appropriate artifact node.
        const pathParts = queryPath.split("/");
        let curArtifactNode = artifactNode;
        pathParts.forEach((part) => {
          curArtifactNode = curArtifactNode.children[part];
        });
        // Then set children on that artifact node.
        curArtifactNode.setChildren(files);
      }
      return {
        ...state,
        [runUuid]: artifactNode,
      };
    }
    default:
      return state;
  }
};

export const getArtifactRootUri = (runUuid, state) => {
  return state.entities.artifactRootUriByRunUuid[runUuid];
};

const artifactRootUriByRunUuid = (state = {}, action) => {
  switch (action.type) {
    case fulfilled(LIST_ARTIFACTS_API): {
      const runUuid = action.meta.runUuid;
      return {
        ...state,
        [runUuid]: action.payload.root_uri,
      };
    }
    default:
      return state;
  }
};

const entities = combineReducers({
  experimentsById,
  runInfosByUuid,
  metricsByRunUuid,
  latestMetricsByRunUuid,
  paramsByRunUuid,
  tagsByRunUuid,
  artifactsByRunUuid,
  artifactRootUriByRunUuid,
});

export const getSharedParamKeysByRunUuids = (runUuids, state) =>
  _.intersection(
    ...runUuids.map((runUuid) => Object.keys(state.entities.paramsByRunUuid[runUuid])),
  );

export const getSharedMetricKeysByRunUuids = (runUuids, state) =>
  _.intersection(
    ...runUuids.map((runUuid) => Object.keys(state.entities.latestMetricsByRunUuid[runUuid])),
  );

export const getApis = (requestIds, state) => {
  return requestIds.map((id) => (
    state.apis[id]
  ));
};

const apis = (state = {}, action) => {
  if (isPendingApi(action)) {
    return {
      ...state,
      [action.meta.id]: { id: action.meta.id, active: true }
    };
  } else if (isFulfilledApi(action)) {
    return {
      ...state,
      [action.meta.id]: { id: action.meta.id, active: false, data: action.payload }
    };
  } else if (isRejectedApi(action)) {
    return {
      ...state,
      [action.meta.id]: { id: action.meta.id, active: false, error: action.payload }
    };
  } else {
    return state;
  }
};

export const isErrorModalOpen = (state) => {
  return state.views.errorModal.isOpen;
};

export const getErrorModalText = (state) => {
  return state.views.errorModal.text;
};

const errorModalDefault = {
  isOpen: false,
  text: '',
};

const errorModal = (state = errorModalDefault, action) => {
  switch (action.type) {
    case CLOSE_ERROR_MODAL: {
      return {
        ...state,
        isOpen: false,
      };
    }
    case OPEN_ERROR_MODAL: {
      return {
        isOpen: true,
        text: action.text,
      };
    }
    default:
      return state;
  }
};

const views = combineReducers({
  errorModal,
});

export const rootReducer = combineReducers({
  entities,
  views,
  apis,
});
