package nl.nn.adapterframework.larva.api;

import nl.nn.adapterframework.configuration.IbisContext;
import nl.nn.adapterframework.larva.MessageListener;
import nl.nn.adapterframework.larva.TestPreparer;
import nl.nn.adapterframework.larva.TestTool;
import nl.nn.adapterframework.util.AppConstants;
import nl.nn.adapterframework.util.LogUtil;
import nl.nn.adapterframework.webcontrol.api.ApiException;
import org.apache.log4j.Logger;
import org.jboss.resteasy.core.ExceptionAdapter;
import org.jboss.resteasy.plugins.providers.multipart.InputPart;
import org.jboss.resteasy.plugins.providers.multipart.MultipartFormDataInput;
import org.jboss.resteasy.spi.ResteasyProviderFactory;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import javax.annotation.security.RolesAllowed;
import javax.servlet.ServletConfig;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpSession;
import javax.ws.rs.*;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import java.io.File;
import java.io.IOException;
import java.util.*;

@Path("/")
public class LarvaApi {
    @Context
    ServletConfig servletConfig;

    private static IbisContext ibisContext;
    private static String realPath;

    private static Logger logger = LogUtil.getLogger(LarvaApi.class);

    /**
     * Returns the param names and possible values that will be required for execution.
     * @return json object that contains all the params.
     * @throws ApiException If there has been a problem creating json.
     */
    @GET
    @RolesAllowed({"IbisObserver", "IbisDataAdmin", "IbisAdmin", "IbisTester"})
    @Path("/larva/params")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getParams(@Context HttpServletRequest request) throws ApiException {
        getContext();
        MessageListener messageListener = getOrCreateMessageListener(request);
        JSONArray logLevels = new JSONArray(messageListener.getLogLevels());
        JSONObject toReturn = new JSONObject();
        try {
            Map<String, Object> scenarioList = getScenarioList(null, TestTool.getAppConstants(ibisContext), realPath);
            JSONObject rootDirectories = new JSONObject(TestPreparer.scenariosRootDirectories);
            toReturn.append("scenarios", scenarioList.get("scenarios"));
            toReturn.append("defaultRootDirectory", scenarioList.get("rootDirectory"));
            toReturn.append("rootDirectories", rootDirectories);
            toReturn.append("logLevels", logLevels);
            toReturn.append("selectedLogLevel", messageListener.getSelectedLogLevel());
        } catch (JSONException e) {
            e.printStackTrace();
            throw new ApiException(e.getMessage());
        }
        logger.debug("Returning params.");
        return Response.status(Response.Status.OK).entity(toReturn.toString()).build();
    }

    /**
     * Returns the messages after a given timestamp.
     * @param timestamp Timestamp to use for filtering.
     * @return List of messages that fit the criteria.
     */
    @GET
    @RolesAllowed({"IbisObserver", "IbisDataAdmin", "IbisAdmin", "IbisTester"})
    @Path("/larva/messages/{timestamp}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getMessages(@Context HttpServletRequest request, @PathParam("timestamp") long timestamp) {
        getContext();
        MessageListener messageListener = getOrCreateMessageListener(request);
        JSONArray messages = messageListener.getMessages(timestamp);
        if(messages.length() == 0) {
            logger.debug("No messages exist.");
            return Response.status(Response.Status.NO_CONTENT).build();
        }
        logger.debug("Returnin messages after " + timestamp);
        return Response.status(Response.Status.OK).entity(messages.toString()).build();
    }

    /**
     * Executes the tests with the given parameters.
     * @param input Form Data that contains scenario and rootDirectory (required); and logLevel, waitBeforeCleanup and numberOfThreads (optionally)
     * @return Status.OK if the execution started successfully.
     */
    @POST
    @RolesAllowed({"IbisObserver", "IbisDataAdmin", "IbisAdmin", "IbisTester"})
    @Path("/larva/execute")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    public Response executeTests(@Context HttpServletRequest request, MultipartFormDataInput input) {
        getContext();
        MessageListener messageListener = getOrCreateMessageListener(request);
        int waitBeforecleanup = 100;
        int numberOfThreads = 1;
        int timeout = Integer.MAX_VALUE;
        String currentScenariosRootDirectory, paramExecute;

        messageListener.clean();
        Map<String, List<InputPart>> data = input.getFormDataMap();

        logger.debug("Parsing parameters for execution.");
        try {
            waitBeforecleanup = data.get("waitBeforeCleanup").get(0).getBody(Integer.class, int.class);
        }catch (IOException | NullPointerException | ExceptionAdapter e) {
            e.printStackTrace();
            logger.error("Could not decode waitBeforeCleanup, using default instead.\n");
        }
        try {
            String logLevel = data.get("logLevel").get(0).getBodyAsString();
            messageListener.setSelectedLogLevel(logLevel);
        } catch (IOException | NullPointerException | ExceptionAdapter e) {
            logger.debug("No log level found.");
        } catch (Exception e) {
            e.printStackTrace();
            logger.error("Error setting the log level: " + e.getMessage());
        }
        try {
            numberOfThreads = data.get("numberOfThreads").get(0).getBody(Integer.class, int.class);
        }catch (IOException | NullPointerException | ExceptionAdapter e) {
            e.printStackTrace();
            logger.error("Could not decode number of threads, using default instead." );
        }
        try {
            timeout = data.get("timeout").get(0).getBody(Integer.class, int.class);
            if (timeout == -1)
                timeout = Integer.MAX_VALUE;
        }catch (IOException | NullPointerException | ExceptionAdapter e) {
            e.printStackTrace();
            logger.error("Could not decode number of threads, using default instead." );
        }
        try {
            currentScenariosRootDirectory = data.get("rootDirectory").get(0).getBodyAsString();
            paramExecute = data.get("scenario").get(0).getBodyAsString();
        }catch (IOException | NullPointerException e) {
            logger.error("Could not decode parameters! " + e.getMessage());
            return Response.status(Response.Status.BAD_REQUEST).build();
        }
        logger.debug("Creating test runner thread.");
        Thread testRunner = new Thread() {
            String paramExecute, currentScenariosRootDirectory;
            int paramWaitBeforeCleanUp, numberOfThreads, timeout;
            MessageListener messageListener;

            @Override
            public void run() {
                TestTool testTool = new TestTool(messageListener);
                testTool.runScenarios(paramExecute, paramWaitBeforeCleanUp, currentScenariosRootDirectory, numberOfThreads, timeout);
            }

            Thread initTestParams(String paramExecute, int paramWaitBeforeCleanUp, String currentScenariosRootDirectory, int numberOfThreads, int timeout, MessageListener messageListener) {
                this.paramExecute = paramExecute;
                this.paramWaitBeforeCleanUp = paramWaitBeforeCleanUp;
                this.currentScenariosRootDirectory = currentScenariosRootDirectory;
                this.numberOfThreads = numberOfThreads;
                this.timeout = timeout;
                this.messageListener = messageListener;
                return this;
            }
        }.initTestParams(paramExecute, waitBeforecleanup, currentScenariosRootDirectory, numberOfThreads, timeout, messageListener);

        logger.info("Starting to execute tests.");
        testRunner.start();

        if(testRunner.isAlive())
            return Response.status(Response.Status.OK).build();

        return Response.status(Response.Status.INTERNAL_SERVER_ERROR).build();
    }

    /**
     * Sets the log level
     * @param json the log level to be set.
     * @return Status.OK if it was set correctly, otherwise BAD request.
     */
    @POST
    @RolesAllowed({"IbisObserver", "IbisDataAdmin", "IbisAdmin", "IbisTester"})
    @Path("/larva/loglevel")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response setLogLevel(@Context HttpServletRequest request, LinkedHashMap<String, Object> json){
        getContext();
        MessageListener messageListener = getOrCreateMessageListener(request);
        try {
            messageListener.setSelectedLogLevel(json.get("logLevel").toString());
            return Response.status(Response.Status.OK).build();
        }catch (Exception e) {
            return Response.status(Response.Status.BAD_REQUEST).build();
        }
    }

    /**
     * If loglevel is given gets all the messages with the new log level, otherwise returns all the messages.
     * @param json the log level to be used. If null, it will be set to "Debug", meaning all of the messages will be returned.
     * @return All messages above given log level.
     */
    @POST
    @RolesAllowed({"IbisObserver", "IbisDataAdmin", "IbisAdmin", "IbisTester"})
    @Path("/larva/messages")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response getMessagesWithLogLevel(@Context HttpServletRequest request, LinkedHashMap<String, Object> json){
        getContext();
        MessageListener messageListener = getOrCreateMessageListener(request);
        try {
            String logLevel = json.get("logLevel").toString();
            if(logLevel == null)
                logLevel = "Debug";
            messageListener.setSelectedLogLevel(logLevel);
            JSONArray messages = messageListener.getMessages();
            return Response.status(Response.Status.OK).entity(messages.toString()).build();
        }catch (Exception e) {
            return Response.status(Response.Status.BAD_REQUEST).build();
        }
    }

    /**
     * Returns the scenarios in a given directory.
     * @param input JSON object containing the directory to start the search from.
     * @return List of scenarios in the given directory.
     */
    @POST
    @RolesAllowed({"IbisObserver", "IbisDataAdmin", "IbisAdmin", "IbisTester"})
    @Path("/larva/scenarios/")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response getScenarios(Map<String, Object> input){
        getContext();
        String rootDirectory = input.get("rootDirectory").toString();
        Map<String, Object> list = getScenarioList(rootDirectory, TestTool.getAppConstants(ibisContext), realPath);
        if(list.size() == 0) {
           return Response.status(Response.Status.NO_CONTENT).build();
        }

        return Response.status(Response.Status.OK).entity(new JSONObject(list).toString()).build();
    }

    @POST
    @RolesAllowed({"IbisObserver", "IbisDataAdmin", "IbisAdmin", "IbisTester"})
    @Path("/larva/save/")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response savePipelineMessage(Map<String, Object> input) {
        String filePath, content;
        try {
            filePath = input.get("filepath").toString();
            content = input.get("content").toString();
            if(filePath == null || content == null)
                return Response.status(Response.Status.BAD_REQUEST).build();
        }catch (ClassCastException e) {
            logger.error(e.getMessage());
            throw new ApiException("Error getting the parameters: " + e.getMessage());
        }
        try {
            TestTool.writeFile(filePath, content);
        } catch (IOException e) {
            logger.error(e.getMessage());
            throw new ApiException("Error saving the pipeline message: " + e.getMessage());
        }
        return Response.status(Response.Status.OK).build();
    }

    /**
     * Returns the scenarios found and the root directory they were found in. If rootDirectory is null, it will search for root directories.
     * @param rootDirectory Directory to get the scenarios from.
     * @param appConstants App Constants to use during search.
     * @param realPath Path of the current execution.
     * @return List of scenarios and the root directory they were found in.
     */
    private Map<String, Object> getScenarioList(String rootDirectory, AppConstants appConstants, String realPath) {
        String appConstantsRealPath = appConstants.getResolvedProperty("webapp.realpath");
        if(appConstantsRealPath != null) {
            realPath = appConstantsRealPath + "larva/";
        }
        rootDirectory = TestPreparer.initScenariosRootDirectories(realPath, rootDirectory, appConstants);
        appConstants = TestTool.getAppConstants(ibisContext);
        Map<String, List<File>> scenarioFiles = TestPreparer.readScenarioFiles(rootDirectory, false, appConstants);
        Collections.sort(scenarioFiles.get(""));
        Map<String, String> scenarioList = TestPreparer.getScenariosList(scenarioFiles, rootDirectory, appConstants);
        Map<String, Object> result = new HashMap<>();
        result.put("scenarios", scenarioList);
        result.put("rootDirectory", rootDirectory);
        return result;
    }

    /**
     * Initializes the IbisContext.
     */
    private void getContext() {
        if(ibisContext!=null)
            return;
        String servletPath = ResteasyProviderFactory.getContextData(HttpServletRequest.class).getServletPath();
        logger.debug("Servlet Path: " + servletPath);
        int i = servletPath.lastIndexOf('/');
        realPath = servletConfig.getServletContext().getRealPath(servletPath.substring(0, i));
        logger.debug("Real Path: " + realPath);
        ibisContext = TestTool.getIbisContext(servletConfig.getServletContext());
    }

    private MessageListener getOrCreateMessageListener(@Context HttpServletRequest request) {
        HttpSession session = request.getSession(true);
        MessageListener messageListener = (MessageListener) session.getAttribute("messageListener");
        if(messageListener == null) {
            messageListener = new MessageListener();
            session.setAttribute("messageListener", messageListener);
        }
        return messageListener;
    }
}